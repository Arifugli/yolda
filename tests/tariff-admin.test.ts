import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "../lib/db";
import { mutate } from "../lib/service";
import { listTariffs } from "../lib/orders/tariff-admin";
import { quoteRide } from "../lib/orders/pricing";
import type { User } from "../lib/auth";
const users: User[] = [],
  ids: string[] = [],
  code = "test_" + randomUUID();
let original: any;
const rules = {
  base: 7000,
  perKm: 2500,
  minimum: 10000,
  roundTo: 1000,
  maxKm: 150,
};
const update = (u: User, b: object, key = randomUUID()) =>
  mutate(u, "admin.tariff", undefined, b, key);
const change = (extra: object = {}) => ({
  serviceType: "ride",
  code,
  expectedVersion: 1,
  rules,
  reason: "Тестовая корректировка тарифа",
  ...extra,
});
before(async () => {
  process.env.APP_MODE = "demo";
  for (const role of ["admin", "user", "support"]) {
    const id = randomUUID();
    users.push(
      (
        await pool.query(
          "INSERT INTO users(name,phone,phone_verified,identity,dob,role) VALUES($1,$2,true,'verified','1990-01-01',$3) RETURNING *",
          ["tariff-test", id, role],
        )
      ).rows[0],
    );
  }
  await pool.query(
    "INSERT INTO order_tariffs(service_type,code,version,rules) VALUES('ride',$1,1,$2)",
    [code, JSON.stringify(rules)],
  );
  original = (
    await pool.query(
      "SELECT * FROM order_tariffs WHERE service_type='ride' AND code='economy' AND active",
    )
  ).rows[0];
});
after(async () => {
  await pool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])", [ids]);
  await transaction(async (db) => {
    await db.query(
      "DELETE FROM order_tariffs WHERE service_type='ride' AND code='economy' AND version>$1",
      [original.version],
    );
    await db.query(
      "UPDATE order_tariffs SET active=true WHERE service_type='ride' AND code='economy' AND version=$1",
      [original.version],
    );
    await db.query("DELETE FROM order_tariffs WHERE code=$1", [code]);
  });
  const u = users.map((u) => u.id);
  await pool.query("DELETE FROM audit_logs WHERE actor_id=ANY($1::uuid[])", [
    u,
  ]);
  await pool.query("DELETE FROM idempotency WHERE user_id=ANY($1::uuid[])", [
    u,
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [u]);
  await pool.end();
});
test("Tariffs: only admin can read/update; unknown fields and invalid rates rejected", async () => {
  for (const u of users.slice(1)) {
    await assert.rejects(listTariffs(u));
    await assert.rejects(update(u, change()));
  }
  for (const bad of [
    { base: -1 },
    { perKm: Infinity },
    { roundTo: 0 },
    { perHour: 100 },
    { maxKm: 1001 },
    { perKm: 1000000, maxKm: 1000, base: 100000000 },
  ])
    await assert.rejects(
      update(users[0], change({ rules: { ...rules, ...bad } })),
    );
  await assert.rejects(
    update(users[0], change({ rules: { ...rules, secret: 1 } })),
  );
  await assert.rejects(update(users[0], change({ reason: "" })));
  assert.equal(
    (
      await pool.query("SELECT count(*) FROM order_tariffs WHERE code=$1", [
        code,
      ])
    ).rows[0].count,
    "1",
  );
});
test("Tariffs: competing edits have one winner; idempotent replay and immutable history", async () => {
  const a = change({ rules: { ...rules, base: 9000 } }),
    b = change({ rules: { ...rules, base: 11000 } }),
    key = randomUUID();
  const outcomes = await Promise.allSettled([
    update(users[0], a, key),
    update(users[0], b),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  const rows = (
    await pool.query(
      "SELECT * FROM order_tariffs WHERE code=$1 ORDER BY version",
      [code],
    )
  ).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].active, false);
  assert.deepEqual(rows[0].rules, rules);
  assert.equal(rows[1].active, true);
  if (outcomes[0].status === "fulfilled") {
    assert.deepEqual(await update(users[0], a, key), outcomes[0].value);
    await assert.rejects(update(users[0], b, key));
  }
  await assert.rejects(update(users[0], change()), /уже изменён/);
  const audit = (
    await pool.query(
      "SELECT detail FROM audit_logs WHERE actor_id=$1 AND action='tariff.update'",
      [users[0].id],
    )
  ).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].detail.reason, a.reason);
  assert.ok(
    (await listTariffs(users[0])).some(
      (t) => t.code === code && t.version === 2,
    ),
  );
});
test("Tariffs: update affects new quotes only; stale booking is rejected and snapshot preserved", async () => {
  const route = {
    origin: {
      city: "Фергана",
      address: "Начальная точка 12",
      lat: 40.386,
      lng: 71.786,
    },
    destination: {
      city: "Фергана",
      address: "Конечная точка 24",
      lat: 40.4,
      lng: 71.8,
    },
  };
  const old = await transaction((db) => quoteRide(db, route));
  const b = {
    ...route,
    kind: "taxi",
    vehicleKind: "sedan",
    description: "Тест снимка тарифа",
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    budget: old.price,
    quotedTariffVersion: old.tariffVersion,
    safetyConfirmed: true,
  };
  const order = await mutate(
    users[1],
    "mobility.create",
    undefined,
    b,
    randomUUID(),
  );
  ids.push(order.id);
  const body = change({
      code: "economy",
      expectedVersion: old.tariffVersion,
      rules: { ...old.rules, base: old.rules.base + 10000 },
    }),
    key = randomUUID();
  const saved = await update(users[0], body, key);
  assert.deepEqual(await update(users[0], body, key), saved);
  const next = await transaction((db) => quoteRide(db, route));
  assert.equal(next.tariffVersion, old.tariffVersion + 1);
  assert.ok(next.price > old.price);
  await assert.rejects(
    mutate(users[1], "mobility.create", undefined, b, randomUUID()),
    /Тариф изменился/,
  );
  const snapshot = (
    await pool.query("SELECT price_snapshot FROM orders WHERE id=$1", [
      order.id,
    ])
  ).rows[0].price_snapshot;
  assert.equal(snapshot.price, old.price);
  assert.equal(snapshot.tariffVersion, old.tariffVersion);
});

test("Tariffs: freight and equipment preserve service-specific rules", async () => {
  for (const serviceType of ["freight", "equipment"] as const) {
    const heavyRules = {
      ...rules,
      perKm: serviceType === "freight" ? 5000 : 0,
      perHour: serviceType === "equipment" ? 100000 : 0,
    };
    await pool.query(
      "INSERT INTO order_tariffs(service_type,code,version,rules) VALUES($1,$2,1,$3)",
      [serviceType, code, JSON.stringify(heavyRules)],
    );
    await assert.rejects(
      update(
        users[0],
        change({
          serviceType,
          rules: { ...heavyRules, perKm: 100, perHour: 100 },
        }),
      ),
    );
    const saved = await update(
      users[0],
      change({ serviceType, rules: { ...heavyRules, base: 20000 } }),
    );
    assert.equal(saved.version, 2);
    const active = (
      await pool.query(
        "SELECT rules FROM order_tariffs WHERE service_type=$1 AND code=$2 AND active",
        [serviceType, code],
      )
    ).rows[0];
    assert.equal(active.rules.base, 20000);
    assert.equal(active.rules.perHour, heavyRules.perHour);
    assert.equal(active.rules.perKm, heavyRules.perKm);
  }
});
