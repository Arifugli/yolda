import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../lib/db";
import { mutate } from "../lib/service";
import { mobilityDetail, mobilityList } from "../lib/mobility";
import type { User } from "../lib/auth";
import { calculateRide, quoteRide } from "../lib/orders/pricing";
const taxiQuote = (body: unknown) =>
  calculateRide(body, {
    base: 7000,
    perKm: 2500,
    minimum: 10000,
    roundTo: 1000,
    maxKm: 150,
  });
const users: User[] = [],
  requests: string[] = [],
  vehicles: string[] = [];
const prefix = "mobility-test-" + randomUUID();
const call = (
  u: User,
  action: string,
  id?: string,
  body: object = {},
  key = randomUUID(),
) => mutate(u, "mobility." + action, id, body, key);
const input = (kind = "taxi", vehicleKind = "sedan") => ({
  kind,
  vehicleKind,
  origin: {
    city: "Фергана",
    address: "Секретный адрес отправления 12",
    lat: 40.386,
    lng: 71.786,
  },
  ...(kind !== "equipment"
    ? {
        destination: {
          city: "Фергана",
          address: "Секретный адрес назначения 24",
          lat: 40.4,
          lng: 71.8,
        },
      }
    : {}),
  description: "Приватное описание работ",
  scheduledAt: new Date(Date.now() + 300000).toISOString(),
  passengers: 3,
  weightTonnes: 5,
  liftTonnes: 8,
  reachMeters: 12,
  durationHours: 2,
  budget:
    kind === "taxi"
      ? taxiQuote({
          origin: { lat: 40.386, lng: 71.786 },
          destination: { lat: 40.4, lng: 71.8 },
        }).price
      : 150000,
  safetyConfirmed: true,
});
async function vehicle(u: User, kind = "sedan", overrides: object = {}) {
  const b = {
    kind,
    name: "Test vehicle",
    plate: prefix.slice(0, 15),
    seats: 4,
    capacityTonnes: 10,
    liftTonnes: 15,
    reachMeters: 20,
    active: true,
    qualificationsConfirmed: true,
    ...overrides,
  };
  const v = await call(u, "vehicle", undefined, b);
  vehicles.push(v.id);
  return { ...b, id: v.id };
}
async function request(
  u: User,
  kind = "taxi",
  vehicleKind = "sedan",
  key = randomUUID(),
) {
  const b = input(kind, vehicleKind);
  const r = await call(u, "create", undefined, b, key);
  requests.push(r.id);
  return { id: r.id, body: b, key };
}
async function assigned(kind = "taxi", vehicleKind = "sedan") {
  const s = await request(users[0], kind, vehicleKind),
    v = await vehicle(users[1], vehicleKind);
  if (kind === "taxi") {
    await call(users[1], "presence", undefined, {
      online: true,
      vehicleId: v.id,
      lat: 40.386,
      lng: 71.787,
      accuracy: 10,
      consent: true,
    });
    await call(users[0], "dispatch", s.id);
    await call(users[1], "accept", s.id);
  } else {
    await call(users[1], "offer", s.id, {
      vehicleId: v.id,
      price: 180000,
      comment: "Весь заказ",
    });
    await call(users[0], "assign", s.id, { providerId: users[1].id });
  }
  return s;
}
async function close(id: string) {
  await pool.query(
    "UPDATE service_requests SET status='cancelled' WHERE id=$1",
    [id],
  );
}
before(async () => {
  process.env.APP_MODE = "demo";
  for (let i = 0; i < 5; i++)
    users.push(
      (
        await pool.query(
          "INSERT INTO users(name,phone,phone_verified,identity,dob,role) VALUES($1,$2,true,$3,'1990-01-01',$4) RETURNING *",
          [
            prefix + i,
            prefix + i,
            i === 3 ? "unverified" : "verified",
            i === 4 ? "support" : "user",
          ],
        )
      ).rows[0],
    );
});
after(async () => {
  const ids = users.map((u) => u.id);
  await pool.query("DELETE FROM taxi_presence WHERE user_id=ANY($1::uuid[])", [
    ids,
  ]);
  await pool.query("DELETE FROM service_requests WHERE id=ANY($1::uuid[])", [
    requests,
  ]);
  await pool.query("DELETE FROM service_vehicles WHERE id=ANY($1::uuid[])", [
    vehicles,
  ]);
  await pool.query("DELETE FROM idempotency WHERE user_id=ANY($1::uuid[])", [
    ids,
  ]);
  await pool.query("DELETE FROM audit_logs WHERE actor_id=ANY($1::uuid[])", [
    ids,
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  await pool.end();
});
afterEach(async () => {
  await pool.query("DELETE FROM taxi_presence WHERE user_id=ANY($1::uuid[])", [
    users.map((u) => u.id),
  ]);
  await pool.query(
    "UPDATE service_requests SET status='cancelled' WHERE id=ANY($1::uuid[]) AND status NOT IN ('completed','cancelled')",
    [requests],
  );
});
test("Такси: автопоиск, подтверждение водителя, код начала, завершение заказчиком и отзывы", async () => {
  const s = await assigned();
  assert.equal(
    (await mobilityDetail(users[0], s.id)).agreed_price,
    s.body.budget,
  );
  await assert.rejects(call(users[1], "complete", s.id));
  if (s.body.kind === "taxi") await call(users[1], "depart", s.id);
  await call(users[1], "arrive", s.id);
  const { code } = await call(users[0], "code", s.id);
  await assert.rejects(call(users[0], "code", s.id));
  await call(users[1], "start", s.id, { code });
  await assert.rejects(call(users[0], "cancel", s.id));
  await assert.rejects(call(users[1], "start", s.id, { code }));
  await call(users[1], "message", s.id, { text: "В пути" });
  await call(users[1], "finish", s.id);
  await assert.rejects(call(users[1], "complete", s.id));
  await call(users[0], "complete", s.id);
  await call(users[0], "review", s.id, {
    stars: 5,
    comment: "Хорошая поездка",
  });
  assert.equal((await mobilityDetail(users[1], s.id)).reviews.length, 0);
  await call(users[1], "review", s.id, { stars: 5, comment: "Спасибо" });
  assert.equal((await mobilityDetail(users[0], s.id)).reviews.length, 2);
  await assert.rejects(
    call(users[0], "review", s.id, { stars: 1, comment: "Дубль" }),
  );
  assert.equal((await mobilityDetail(users[0], s.id)).status, "completed");
});
test("Один профиль может быть заказчиком и исполнителем разных заказов", async () => {
  const s = await request(users[2], "cargo", "van"),
    v = await vehicle(users[0], "van");
  await call(users[0], "offer", s.id, { vehicleId: v.id, price: 50000 });
  await call(users[2], "assign", s.id, { providerId: users[0].id });
  assert.equal((await mobilityDetail(users[0], s.id)).provider_id, users[0].id);
  await call(users[0], "decline", s.id);
  assert.equal((await mobilityDetail(users[2], s.id)).status, "published");
  await assert.rejects(mobilityDetail(users[0], randomUUID()));
});
test("Груз и кран: совместимость, грузоподъёмность и вылет стрелы проверяются сервером", async () => {
  const cargo = await request(users[0], "cargo", "semi_trailer"),
    small = await vehicle(users[1], "semi_trailer", { capacityTonnes: 2 });
  await assert.rejects(
    call(users[1], "offer", cargo.id, { vehicleId: small.id, price: 10000 }),
  );
  const large = await vehicle(users[1], "semi_trailer", { capacityTonnes: 20 });
  await call(users[1], "offer", cargo.id, {
    vehicleId: large.id,
    price: 500000,
  });
  await call(users[0], "assign", cargo.id, { providerId: users[1].id });
  await close(cargo.id);
  const crane = await request(users[0], "equipment", "crane"),
    short = await vehicle(users[1], "crane", { reachMeters: 5 });
  await assert.rejects(
    call(users[1], "offer", crane.id, { vehicleId: short.id, price: 500000 }),
  );
  const good = await vehicle(users[1], "crane");
  await call(users[1], "offer", crane.id, {
    vehicleId: good.id,
    price: 800000,
  });
  await call(users[0], "assign", crane.id, { providerId: users[1].id });
  await close(crane.id);
});
test("Запрещены чужая машина, собственный заказ, неподтверждённая личность и лишние пассажиры", async () => {
  const s = await request(users[0]),
    v = await vehicle(users[1], "sedan", { seats: 2 });
  await assert.rejects(
    call(users[2], "offer", s.id, { vehicleId: v.id, price: 10000 }),
  );
  await assert.rejects(
    call(users[0], "offer", s.id, { vehicleId: v.id, price: 10000 }),
  );
  await assert.rejects(
    call(users[3], "vehicle", undefined, { ...v, id: undefined }),
  );
  await assert.rejects(
    call(users[1], "offer", s.id, { vehicleId: v.id, price: 10000 }),
  );
  await assert.rejects(
    call(users[0], "create", undefined, { ...input(), vehicleKind: "crane" }),
  );
  await assert.rejects(
    call(users[0], "create", undefined, {
      ...input(),
      scheduledAt: "2020-01-01T00:00:00.000Z",
    }),
  );
});
test("Публичный поиск скрывает адреса, описание, заказчика, чужие предложения и чат", async () => {
  const s = await request(users[0]);
  const list = await mobilityList(
    users[2],
    new URLSearchParams({ kind: "taxi", view: "market" }),
  );
  const entry = list.find((x) => x.id === s.id)!;
  assert.equal(entry.data.origin.address, undefined);
  assert.equal((entry as any).customer_id, undefined);
  const detail = await mobilityDetail(users[2], s.id);
  assert.equal(detail.data.description, undefined);
  assert.equal(detail.offers, undefined);
  assert.equal(detail.messages, undefined);
  await assert.rejects(
    call(users[2], "message", s.id, { text: "Посторонний" }),
  );
  await assert.rejects(
    mobilityList(users[2], new URLSearchParams({ view: "support" })),
  );
});
test("Повтор запроса не создаёт вторую заявку, изменённое тело с тем же ключом отклоняется", async () => {
  const s = await request(users[0]);
  assert.equal(
    (await call(users[0], "create", undefined, s.body, s.key)).id,
    s.id,
  );
  await assert.rejects(
    call(users[0], "create", undefined, { ...s.body, budget: 2000 }, s.key),
  );
});
test("Пять неверных кодов сохраняются и блокируют начало, отмена после начала запрещена", async () => {
  const s = await assigned();
  if (s.body.kind === "taxi") await call(users[1], "depart", s.id);
  await call(users[1], "arrive", s.id);
  const { code } = await call(users[0], "code", s.id);
  const wrong = code === "000000" ? "000001" : "000000";
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await call(users[1], "start", s.id, { code: wrong })).rejected,
      true,
    );
  await assert.rejects(call(users[1], "start", s.id, { code }));
  assert.equal(
    (
      await pool.query(
        "SELECT attempts FROM service_start_codes WHERE request_id=$1",
        [s.id],
      )
    ).rows[0].attempts,
    5,
  );
  await close(s.id);
});
test("Назначение перепроверяет ограничения аккаунта и изменённую вместимость машины", async () => {
  const s = await request(users[0], "cargo", "van"),
    v = await vehicle(users[1], "van");
  await call(users[1], "offer", s.id, { vehicleId: v.id, price: 50000 });
  await call(users[1], "vehicle", undefined, { ...v, capacityTonnes: 1 });
  await assert.rejects(
    call(users[0], "assign", s.id, { providerId: users[1].id }),
  );
  await call(users[1], "vehicle", undefined, v);
  await pool.query("UPDATE users SET restricted=true WHERE id=$1", [
    users[1].id,
  ]);
  try {
    await assert.rejects(
      call(users[0], "assign", s.id, { providerId: users[1].id }),
    );
  } finally {
    await pool.query("UPDATE users SET restricted=false WHERE id=$1", [
      users[1].id,
    ]);
  }
});
test("Конкурентное назначение: один исполнитель получает только одну активную заявку", async () => {
  const a = await request(users[0], "cargo", "van"),
    b = await request(users[2], "cargo", "van"),
    v = await vehicle(users[1], "van");
  for (const s of [a, b])
    await call(users[1], "offer", s.id, { vehicleId: v.id, price: 50000 });
  const results = await Promise.allSettled([
    call(users[0], "assign", a.id, { providerId: users[1].id }),
    call(users[2], "assign", b.id, { providerId: users[1].id }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await close(a.id);
  await close(b.id);
});
test("Спор блокирует завершение, доступ поддержки аудируется, посторонний не может разрешить спор", async () => {
  const s = await assigned();
  if (s.body.kind === "taxi") await call(users[1], "depart", s.id);
  await call(users[1], "arrive", s.id);
  const { code } = await call(users[0], "code", s.id);
  await call(users[1], "start", s.id, { code });
  await call(users[1], "finish", s.id);
  await call(users[0], "dispute", s.id, {
    reason: "Не выполнены условия поездки",
  });
  await assert.rejects(call(users[0], "complete", s.id));
  await assert.rejects(
    call(users[0], "resolve", s.id, { resolution: "Я сам решил" }),
  );
  await assert.rejects(mobilityDetail(users[2], s.id));
  assert.equal((await mobilityDetail(users[4], s.id)).dispute_status, "open");
  await call(users[4], "resolve", s.id, {
    resolution: "Стороны согласовали выполнение",
  });
  await call(users[0], "complete", s.id);
  assert.equal((await mobilityDetail(users[0], s.id)).status, "completed");
});
test("RLS закрывает таблицы даже при случайном SELECT-grant непривилегированной роли", async () => {
  const db = await pool.connect(),
    role = "rls_test_" + randomUUID().replaceAll("-", "");
  try {
    await db.query("BEGIN");
    await db.query(`CREATE ROLE ${role}`);
    await db.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await db.query(
      `GRANT SELECT ON users,orders,service_requests,order_events,order_tariffs,sessions TO ${role}`,
    );
    await db.query(`SET LOCAL ROLE ${role}`);
    for (const table of [
      "users",
      "orders",
      "service_requests",
      "order_events",
      "order_tariffs",
      "sessions",
    ])
      assert.equal((await db.query(`SELECT * FROM ${table}`)).rowCount, 0);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
test("Автопоиск выбирает ближайшего подходящего водителя и продолжает поиск после отказа", async () => {
  const far = await vehicle(users[1]),
    near = await vehicle(users[2]);
  await call(users[1], "presence", undefined, {
    online: true,
    vehicleId: far.id,
    lat: 40.41,
    lng: 71.786,
    accuracy: 15,
    consent: true,
  });
  await call(users[2], "presence", undefined, {
    online: true,
    vehicleId: near.id,
    lat: 40.387,
    lng: 71.786,
    accuracy: 15,
    consent: true,
  });
  const s = await request(users[0]);
  assert.equal((await mobilityDetail(users[0], s.id)).provider_id, users[2].id);
  await assert.rejects(call(users[0], "accept", s.id));
  await call(users[2], "decline", s.id);
  await call(users[0], "dispatch", s.id);
  assert.equal((await mobilityDetail(users[0], s.id)).provider_id, users[1].id);
});
test("Просроченная геопозиция, большая погрешность и машина вне радиуса исключаются из поиска", async () => {
  const v = await vehicle(users[1]);
  await assert.rejects(
    call(users[1], "presence", undefined, {
      online: true,
      vehicleId: v.id,
      lat: 40.386,
      lng: 71.786,
      accuracy: 500,
      consent: true,
    }),
  );
  await call(users[1], "presence", undefined, {
    online: true,
    vehicleId: v.id,
    lat: 41.3,
    lng: 69.2,
    accuracy: 10,
    consent: true,
  });
  const s = await request(users[0]);
  assert.equal((await mobilityDetail(users[0], s.id)).status, "published");
  await pool.query(
    "UPDATE taxi_presence SET lat=40.386,lng=71.786,updated_at=now()-interval '3 minutes' WHERE user_id=$1",
    [users[1].id],
  );
  await call(users[0], "dispatch", s.id);
  assert.equal((await mobilityDetail(users[0], s.id)).status, "published");
  await call(users[1], "presence", undefined, {
    online: true,
    vehicleId: v.id,
    lat: 40.386,
    lng: 71.786,
    accuracy: 10,
    consent: true,
  });
  assert.equal((await mobilityDetail(users[0], s.id)).status, "driver_pending");
  await call(users[1], "presence", undefined, { online: false });
  assert.equal(
    (
      await pool.query("SELECT * FROM taxi_presence WHERE user_id=$1", [
        users[1].id,
      ])
    ).rowCount,
    0,
  );
});
test("Неотвеченное предложение истекает и не позволяет водителю принять старую поездку", async () => {
  const v = await vehicle(users[1]);
  await call(users[1], "presence", undefined, {
    online: true,
    vehicleId: v.id,
    lat: 40.386,
    lng: 71.786,
    accuracy: 10,
    consent: true,
  });
  const s = await request(users[0]);
  await pool.query(
    "UPDATE taxi_dispatches SET expires_at=now()-interval '1 second' WHERE request_id=$1",
    [s.id],
  );
  await assert.rejects(call(users[1], "accept", s.id));
  await call(users[0], "dispatch", s.id);
  assert.equal((await mobilityDetail(users[0], s.id)).provider_id, null);
  assert.equal((await mobilityDetail(users[0], s.id)).status, "published");
});
test("Две одновременные поездки не получают одного водителя; клиент не подменяет тариф", async () => {
  const v = await vehicle(users[1]);
  await call(users[1], "presence", undefined, {
    online: true,
    vehicleId: v.id,
    lat: 40.386,
    lng: 71.786,
    accuracy: 10,
    consent: true,
  });
  const [a, b] = await Promise.all([request(users[0]), request(users[2])]);
  const details = await Promise.all([
    mobilityDetail(users[0], a.id),
    mobilityDetail(users[2], b.id),
  ]);
  assert.equal(details.filter((d) => d.status === "driver_pending").length, 1);
  await assert.rejects(
    call(users[0], "create", undefined, { ...input(), budget: 1000 }),
  );
  await assert.rejects(
    call(users[1], "offer", details.find((d) => d.status === "published")!.id, {
      vehicleId: v.id,
      price: 1000,
    }),
  );
});

test("Order v1: authoritative row, canonical events, frozen DB tariff, replay and invalid transitions", async () => {
  const s = await assigned();
  const row = (await pool.query("SELECT * FROM orders WHERE id=$1", [s.id]))
    .rows[0];
  assert.equal(row.engine_version, 1);
  assert.equal(row.service_type, "ride");
  assert.equal(row.state, "accepted");
  assert.equal(row.price_snapshot.price, s.body.budget);
  assert.equal(row.price_snapshot.tariffVersion, 1);
  await assert.rejects(call(users[1], "arrive", s.id), /этапе/);
  await assert.rejects(call(users[2], "depart", s.id), /участник/);
  const key = randomUUID();
  await call(users[1], "depart", s.id, {}, key);
  await call(users[1], "depart", s.id, {}, key);
  const events = (
    await pool.query(
      "SELECT to_state FROM order_events WHERE order_id=$1 ORDER BY id",
      [s.id],
    )
  ).rows.map((r) => r.to_state);
  assert.deepEqual(events, [
    "created",
    "searching",
    "offered",
    "accepted",
    "en_route_to_pickup",
  ]);
  assert.equal(
    (await mobilityDetail(users[0], s.id)).status,
    "en_route_to_pickup",
  );
  await assert.rejects(
    call(users[0], "create", undefined, {
      ...input(),
      quotedTariffVersion: 999,
    }),
    /Тариф изменился/,
  );
});
test("Core rollout disabled: old order remains operable with legacy transitions", async () => {
  const old = process.env.ORDER_CORE_ENABLED;
  try {
    process.env.ORDER_CORE_ENABLED = "false";
    const s = await assigned();
    assert.equal((await mobilityDetail(users[0], s.id)).engine_version, 0);
    await call(users[1], "arrive", s.id);
    assert.equal((await mobilityDetail(users[0], s.id)).status, "arrived");
    assert.equal(
      (await pool.query("SELECT 1 FROM order_events WHERE order_id=$1", [s.id]))
        .rowCount,
      0,
    );
  } finally {
    if (old === undefined) delete process.env.ORDER_CORE_ENABLED;
    else process.env.ORDER_CORE_ENABLED = old;
  }
});

test("Тариф читается из БД; его изменение не меняет снимок уже созданной поездки", async () => {
  const s = await request(users[0]);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "UPDATE order_tariffs SET rules=jsonb_set(rules,'{base}','27000') WHERE service_type='ride' AND active",
    );
    const quote = await quoteRide(db, s.body);
    assert.equal(quote.price, s.body.budget + 20000);
    const stored = (
      await db.query("SELECT price_snapshot FROM orders WHERE id=$1", [s.id])
    ).rows[0];
    assert.equal(stored.price_snapshot.price, s.body.budget);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
