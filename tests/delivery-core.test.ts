import { mobilityDetail, mobilityPresence } from "../lib/mobility";
import { orderSnapshot, orderStream } from "../lib/orders/stream";
import { hash, token } from "../lib/auth";
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../lib/db";
import { mutate, getShipment } from "../lib/service";
import { dispatchTick } from "../lib/orders/worker";
import { rankCandidates, searchRadius } from "../lib/orders/matching";
import type { User } from "../lib/auth";
const users: User[] = [],
  ids: string[] = [],
  vehicles: string[] = [];
const prefix = "core-" + randomUUID();
const phone = "+998" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
const call = (
  u: User,
  action: string,
  id?: string,
  body: any = {},
  key = randomUUID(),
) => mutate(u, action, id, body, key);
const origin = {
  city: "Фергана",
  district: "Центр",
  address: "Тестовая точка А",
  lat: 40.386,
  lng: 71.786,
};
const destination = {
  ...origin,
  address: "Тестовая точка Б",
  lat: 40.4,
  lng: 71.8,
};
async function book() {
  const body = {
    origin,
    destination,
    parcel: "small",
    recipient: users[2].phone,
    allowedContents: true,
    packaging: true,
  };
  const quote = await call(users[0], "delivery.quote", undefined, body);
  const r = await call(users[0], "delivery.book", undefined, {
    ...body,
    quotedPrice: quote.price,
  });
  ids.push(r.id);
  return r.id as string;
}
async function online(u = users[1], lat = 40.386, lng = 71.787) {
  await call(u, "delivery.presence", undefined, {
    online: true,
    transport: "car",
    lat,
    lng,
    accuracy: 10,
    consent: true,
  });
}
async function order(id: string) {
  return (await pool.query("SELECT * FROM orders WHERE id=$1", [id])).rows[0];
}
before(async () => {
  process.env.APP_MODE = "demo";
  delete process.env.DELIVERY_CORE_ENABLED;
  for (let i = 0; i < 4; i++)
    users.push(
      (
        await pool.query(
          "INSERT INTO users(name,phone,phone_verified,identity,dob,profile) VALUES($1,$2,true,'verified','1990-01-01',$3) RETURNING *",
          [
            prefix + i,
            i === 2 ? phone : prefix + i,
            JSON.stringify({
              city: "Фергана",
              accepting: true,
              transport: "car",
            }),
          ],
        )
      ).rows[0],
    );
});
afterEach(async () => {
  await pool.query(
    "DELETE FROM executor_presence WHERE user_id=ANY($1::uuid[])",
    [users.map((u) => u.id)],
  );
  await pool.query(
    "UPDATE orders SET status='cancelled' WHERE id=ANY($1::uuid[]) AND status NOT IN ('completed','cancelled')",
    [ids],
  );
  await pool.query(
    "UPDATE shipments SET status='cancelled' WHERE id=ANY($1::uuid[]) AND status NOT IN ('completed','returned','cancelled')",
    [ids],
  );
});
after(async () => {
  const uids = users.map((u) => u.id);
  for (const table of [
    "reviews",
    "disputes",
    "notifications",
    "handover_codes",
    "handovers",
    "tracking_events",
    "payments",
    "refunds",
    "payouts",
    "assignments",
    "courier_offers",
    "delivery_legs",
    "locations",
    "parcels",
    "messages",
    "conversations",
  ])
    await pool.query(`DELETE FROM ${table} WHERE shipment_id=ANY($1::uuid[])`, [
      ids,
    ]);
  await pool.query("DELETE FROM shipments WHERE id=ANY($1::uuid[])", [ids]);
  await pool.query("DELETE FROM orders WHERE id=ANY($1::uuid[])", [ids]);
  await pool.query(
    "DELETE FROM executor_presence WHERE user_id=ANY($1::uuid[])",
    [uids],
  );
  await pool.query("DELETE FROM service_vehicles WHERE id=ANY($1::uuid[])", [
    vehicles,
  ]);
  await pool.query("DELETE FROM idempotency WHERE user_id=ANY($1::uuid[])", [
    uids,
  ]);
  await pool.query("DELETE FROM audit_logs WHERE actor_id=ANY($1::uuid[])", [
    uids,
  ]);
  await pool.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [
    uids,
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [uids]);
  await pool.end();
});
test("Delivery core: worker finds nearest courier, codes and recipient authorization complete one order", async () => {
  const id = await book();
  assert.equal((await order(id)).state, "searching");
  await assert.rejects(call(users[0], "mobility.cancel", id), /API доставки/);
  await assert.rejects(mobilityDetail(users[0], id), /API доставки/);
  await assert.rejects(call(users[1], "offer", id), /автоматически/);
  await online(users[3], 40.4, 71.79);
  await online();
  await dispatchTick();
  assert.equal((await order(id)).provider_id, users[1].id);
  assert.equal((await mobilityPresence(users[1])).incoming.length, 0);
  await assert.rejects(call(users[3], "delivery.accept", id));
  const key = randomUUID();
  await call(users[1], "delivery.accept", id, {}, key);
  await call(users[1], "delivery.accept", id, {}, key);
  await assert.rejects(call(users[1], "arrive", id));
  await call(users[1], "depart", id);
  await call(users[1], "arrive", id);
  const pickup = await call(users[0], "code", id, { stage: "pickup" });
  await call(users[1], "handover", id, { stage: "pickup", code: pickup.code });
  await assert.rejects(call(users[0], "cancel", id));
  await call(users[1], "transit", id);
  await call(users[1], "destination", id);
  await call(users[1], "ready", id);
  await assert.rejects(call(users[3], "code", id, { stage: "delivery" }));
  const received = await call(users[2], "code", id, { stage: "delivery" });
  await call(users[1], "handover", id, {
    stage: "delivery",
    code: received.code,
  });
  await call(users[2], "complete", id);
  assert.equal((await order(id)).state, "completed");
  assert.equal((await getShipment(users[0], id)).executorPosition, null);
  const states = (
    await pool.query(
      "SELECT to_state FROM order_events WHERE order_id=$1 ORDER BY id",
      [id],
    )
  ).rows.map((r) => r.to_state);
  assert.deepEqual(states, [
    "created",
    "searching",
    "offered",
    "accepted",
    "en_route_to_pickup",
    "arrived",
    "in_progress",
    "completed",
  ]);
});
test("Delivery matching: timeout, decline, stale location, radius expansion and cancellation", async () => {
  const id = await book();
  await online();
  await online(users[3], 40.415, 71.786);
  await dispatchTick();
  assert.equal((await order(id)).provider_id, users[1].id);
  await pool.query(
    "UPDATE order_dispatches SET expires_at=now()-interval '1 second' WHERE request_id=$1",
    [id],
  );
  await assert.rejects(call(users[1], "delivery.accept", id), /истекло/);
  await dispatchTick();
  assert.equal((await order(id)).provider_id, users[3].id);
  await call(users[3], "delivery.reject", id);
  await dispatchTick();
  assert.equal((await order(id)).state, "searching");
  await call(users[0], "cancel", id);
  await assert.rejects(call(users[3], "delivery.accept", id));
  await pool.query(
    "UPDATE executor_presence SET updated_at=now()-interval '3 minutes' WHERE user_id=ANY($1::uuid[])",
    [users.map((u) => u.id)],
  );
  const next = await book();
  await dispatchTick();
  assert.equal((await order(next)).state, "searching");
  assert.equal(searchRadius(new Date(), 0), 2);
  assert.equal(searchRadius(new Date(), 1), 5);
  assert.equal(searchRadius(new Date(), 2), 8);
  assert.equal(
    rankCandidates(
      origin,
      [
        { user_id: "a", lat: 40.386, lng: 71.787 },
        { user_id: "b", lat: 41, lng: 72 },
      ],
      2,
    ).length,
    1,
  );
});
test("One executor cannot receive a taxi and delivery offer simultaneously", async () => {
  const v = await call(users[1], "mobility.vehicle", undefined, {
    kind: "sedan",
    name: "Core test",
    plate: "TEST",
    seats: 4,
    capacityTonnes: 0,
    liftTonnes: 0,
    reachMeters: 0,
    active: true,
    qualificationsConfirmed: true,
  });
  vehicles.push(v.id);
  await online();
  await call(users[1], "mobility.presence", undefined, {
    online: true,
    vehicleId: v.id,
    lat: 40.386,
    lng: 71.787,
    accuracy: 10,
    consent: true,
  });
  const quote = await call(users[0], "mobility.quote", undefined, {
    origin,
    destination,
  });
  const [delivery, ride] = await Promise.all([
    book(),
    call(users[0], "mobility.create", undefined, {
      kind: "taxi",
      vehicleKind: "sedan",
      origin,
      destination,
      description: "Core taxi",
      scheduledAt: new Date().toISOString(),
      passengers: 1,
      budget: quote.price,
      safetyConfirmed: true,
    }),
  ]);
  ids.push(ride.id);
  await dispatchTick();
  const active = (
    await pool.query(
      "SELECT * FROM orders WHERE id=ANY($1::uuid[]) AND provider_id=$2",
      [[delivery, ride.id], users[1].id],
    )
  ).rows;
  assert.equal(active.length, 1);
});

test("Order stream: participant-only fresh positions, current snapshot on reconnect, stale positions hidden", async () => {
  const id = await book();
  await online();
  await dispatchTick();
  await call(users[1], "delivery.accept", id);
  await assert.rejects(orderSnapshot(users[3], id), /доступа/);
  assert.equal(
    (await orderSnapshot(users[0], id)).executorPosition.lng,
    71.787,
  );
  const session = token();
  await pool.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [hash(session), users[0].id],
  );
  for (let i = 0; i < 2; i++) {
    const response = await orderStream(
      id,
      session,
      new AbortController().signal,
    );
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    const reader = response.body!.getReader();
    await reader.read();
    const snapshot = new TextDecoder().decode((await reader.read()).value);
    assert.ok(snapshot.includes(id));
    assert.ok(snapshot.includes("accepted"));
    await reader.cancel();
  }
  await pool.query(
    "UPDATE executor_presence SET updated_at=now()-interval '3 minutes' WHERE user_id=$1",
    [users[1].id],
  );
  assert.equal((await orderSnapshot(users[0], id)).executorPosition, null);
});

test("Delivery return preserves custody codes and releases executor only after confirmed return", async () => {
  const id = await book();
  await online();
  await dispatchTick();
  await call(users[1], "delivery.accept", id);
  await call(users[1], "depart", id);
  await call(users[1], "arrive", id);
  const pickup = await call(users[0], "code", id, { stage: "pickup" });
  await call(users[1], "handover", id, { stage: "pickup", code: pickup.code });
  await call(users[0], "return", id);
  await call(users[1], "returning", id);
  await assert.rejects(call(users[2], "code", id, { stage: "return" }));
  const code = await call(users[0], "code", id, { stage: "return" });
  await call(users[1], "handover", id, { stage: "return", code: code.code });
  assert.equal((await getShipment(users[0], id)).status, "returned");
  assert.equal((await order(id)).state, "completed");
  const another = await book();
  assert.equal((await order(another)).provider_id, users[1].id);
});
test("Matching excludes recipient and rechecks transport and restrictions when accepting", async () => {
  const id = await book();
  await online(users[2]);
  await dispatchTick();
  assert.equal((await order(id)).state, "searching");
  await online();
  await dispatchTick();
  assert.equal((await order(id)).provider_id, users[1].id);
  await pool.query(
    "UPDATE users SET profile=jsonb_set(profile,'{transport}','\"walk\"') WHERE id=$1",
    [users[1].id],
  );
  try {
    await assert.rejects(call(users[1], "delivery.accept", id), /недоступен/);
  } finally {
    await pool.query(
      "UPDATE users SET profile=jsonb_set(profile,'{transport}','\"car\"') WHERE id=$1",
      [users[1].id],
    );
  }
  await pool.query("UPDATE users SET restricted=true WHERE id=$1", [
    users[1].id,
  ]);
  try {
    await assert.rejects(call(users[1], "delivery.accept", id), /ограничен/);
  } finally {
    await pool.query("UPDATE users SET restricted=false WHERE id=$1", [
      users[1].id,
    ]);
  }
});
