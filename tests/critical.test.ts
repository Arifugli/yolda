import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../lib/db";
import { mutate, getShipment, nearby, adminAction } from "../lib/service";
import { assertDemo, lockerProvider } from "../lib/providers";
import type { User } from "../lib/auth";
let sender: User,
  courier: User,
  recipient: User,
  other: User,
  unverified: User,
  operator: User;
const ids: string[] = [],
  shipments: string[] = [];
const prefix = "test-" + randomUUID();
const call = (
  u: User,
  action: string,
  id?: string,
  b: any = {},
  key = randomUUID(),
) => mutate(u, action, id, b, key);
const input = (rec: User = recipient, kind = "person", city = "Фергана") => ({
  origin: {
    kind: "person",
    city,
    district: "Центр",
    address: "Тестовый адрес A",
    lat: city === "Андижан" ? 40.782 : 40.386,
    lng: city === "Андижан" ? 72.344 : 71.786,
  },
  destination: {
    kind,
    city,
    district: "Вокзал",
    address: "Тестовый адрес B",
    lat: city === "Андижан" ? 40.79 : 40.4,
    lng: city === "Андижан" ? 72.35 : 71.8,
    lockerId: kind === "point" ? "andijan-point" : "fergana-locker",
  },
  recipient: rec.public_id,
  category: "Документы",
  description: "Автотест " + prefix,
  weight: 1,
  dimensions: [20, 15, 10],
  declaredValue: 1000,
  fragile: false,
  pickupAt: new Date(Date.now() + 3600000).toISOString(),
  deliverBy: new Date(Date.now() + 10800000).toISOString(),
  instruction: "Приватная инструкция",
  payer: "sender",
  allowedContents: true,
  packaging: true,
  urgent: false,
  photos: [],
});
async function create(
  u = sender,
  rec = recipient,
  kind = "person",
  city = "Фергана",
) {
  const s = await call(u, "create", undefined, input(rec, kind, city));
  shipments.push(s.id);
  return s.id as string;
}
async function publish(id: string, u = sender) {
  await call(u, "pay", id);
  await call(u, "publish", id);
}
async function assign(id: string, u = sender, c = courier) {
  await publish(id, u);
  await call(c, "offer", id);
  await call(u, "assign", id, { courierId: c.id });
}
async function pickup(id: string) {
  await assign(id);
  await call(courier, "arrive", id);
  const { code } = await call(sender, "code", id, { stage: "pickup" });
  await call(courier, "handover", id, { stage: "pickup", code });
  return code;
}
async function atDestination(id: string) {
  await pickup(id);
  await call(courier, "transit", id);
  await call(courier, "destination", id);
}
before(async () => {
  process.env.APP_MODE = "demo";
  for (let i = 0; i < 5; i++) {
    const u = (
      await pool.query(
        "INSERT INTO users(name,phone,phone_verified,identity,dob,profile) VALUES($1,$2,true,$3,'1990-01-01',$4) RETURNING *",
        [
          "Автотест " + i,
          prefix + "-" + i,
          i === 4 ? "unverified" : "verified",
          JSON.stringify({
            city: "Фергана",
            transport: "car",
            accepting: true,
          }),
        ],
      )
    ).rows[0];
    ids.push(u.id);

    if (i === 0) sender = u;
    if (i === 1) courier = u;
    if (i === 2) recipient = u;
    if (i === 3) other = u;
    if (i === 4) unverified = u;
  }
  operator = (
    await pool.query("SELECT * FROM users WHERE role='operator' LIMIT 1")
  ).rows[0];
});
after(async () => {
  for (const table of ["reports", "messages"]) {
    if (table === "reports")
      await pool.query("DELETE FROM reports WHERE author_id=ANY($1::uuid[])", [
        ids,
      ]);
    else
      await pool.query(
        "DELETE FROM messages WHERE shipment_id=ANY($1::uuid[])",
        [shipments],
      );
  }
  for (const table of [
    "files",
    "point_requests",
    "device_events",
    "reservations",
    "payouts",
    "refunds",
    "payments",
    "handovers",
    "handover_codes",
    "tracking_events",
    "reviews",
    "disputes",
    "notifications",
    "assignments",
    "courier_offers",
    "delivery_legs",
    "locations",
    "parcels",
    "conversations",
  ])
    await pool.query(`DELETE FROM ${table} WHERE shipment_id=ANY($1::uuid[])`, [
      shipments,
    ]);
  await pool.query("DELETE FROM shipments WHERE id=ANY($1::uuid[])", [
    shipments,
  ]);
  for (const table of [
    "audit_logs",
    "identity_verifications",
    "sessions",
    "routes",
  ])
    await pool.query(
      `DELETE FROM ${table} WHERE ${table === "audit_logs" ? "actor_id" : "user_id"}=ANY($1::uuid[])`,
      [ids],
    );
  await pool.query("DELETE FROM idempotency WHERE user_id=ANY($1::uuid[])", [
    ids,
  ]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
  await pool.query("DELETE FROM compartments WHERE locker_id IN($1,$2)", [
    "test-origin-" + prefix,
    "test-destination-" + prefix,
  ]);
  await pool.query("DELETE FROM lockers WHERE id IN($1,$2)", [
    "test-origin-" + prefix,
    "test-destination-" + prefix,
  ]);
  await pool.end();
});
test("Один аккаунт одновременно отправляет и доставляет разные посылки", async () => {
  const a = await create();
  const b = await create(other, recipient);
  await assign(b, other, sender);
  assert.equal((await getShipment(sender, a)).sender_id, sender.id);
  assert.equal((await getShipment(sender, b)).courier_id, sender.id);
});
test("Нельзя откликнуться или назначить себя курьером", async () => {
  const id = await create();
  await publish(id);
  await assert.rejects(call(sender, "offer", id), /свой заказ/);
  await assert.rejects(
    call(sender, "assign", id, { courierId: sender.id }),
    /участника/,
  );
});
test("Конкурентные назначения: только один курьер получает заказ", async () => {
  const id = await create();
  await publish(id);
  await call(courier, "offer", id);
  await call(other, "offer", id);
  const r = await Promise.allSettled([
    call(sender, "assign", id, { courierId: courier.id }),
    call(sender, "assign", id, { courierId: other.id }),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (await pool.query("SELECT * FROM assignments WHERE shipment_id=$1", [id]))
      .rowCount,
    1,
  );
});
test("Непроверенный пользователь не может публиковать или принимать доставку", async () => {
  const own = await create(unverified);
  await assert.rejects(call(unverified, "publish", own), /личность/);
  const id = await create();
  await publish(id);
  await assert.rejects(call(unverified, "offer", id), /личность/);
});
test("Посторонний не видит точный адрес, профиль получателя и чат", async () => {
  const id = await create();
  await publish(id);
  await assert.rejects(getShipment(other, id), /участник/);
  const items = await nearby(other, new URLSearchParams({ city: "Фергана" }));
  const s = items.find((s) => s.id === id)!;
  assert.ok(s);
  assert.equal((s.origin as any).address, undefined);
  assert.equal((s as any).recipient_id, undefined);
  await assert.rejects(
    call(other, "message", id, { text: "Вторжение" }),
    /участник/,
  );
});
test("Курьер не завершает доставку одним нажатием", async () => {
  const id = await create();
  await pickup(id);
  await assert.rejects(call(courier, "complete", id), /получатель/);
  assert.equal((await getShipment(sender, id)).status, "picked_up");
});
test("Код связан с заказом, этапом и участником; повторы запрещены", async () => {
  const a = await create();
  await assign(a);
  await call(courier, "arrive", a);
  const { code } = await call(sender, "code", a, { stage: "pickup" });
  const b = await create();
  await assign(b);
  await call(courier, "arrive", b);
  await assert.rejects(
    call(courier, "handover", b, { stage: "pickup", code }),
    /Код/,
  );
  await call(courier, "handover", a, { stage: "pickup", code });
  await assert.rejects(
    call(courier, "handover", a, { stage: "pickup", code }),
    /этап/,
  );
  await assert.rejects(call(other, "code", b, { stage: "pickup" }), /участник/);
});
test("Неверные попытки не откатываются, код блокируется после пяти", async () => {
  const id = await create();
  await assign(id);
  await call(courier, "arrive", id);
  const { code } = await call(sender, "code", id, { stage: "pickup" });
  const wrong = code === "100000" ? "200000" : "100000";
  for (let i = 0; i < 5; i++)
    assert.ok(
      (await call(courier, "handover", id, { stage: "pickup", code: wrong }))
        .error,
    );
  await assert.rejects(
    call(courier, "handover", id, { stage: "pickup", code }),
    /заблокирован/,
  );
});
test("Истекший код не подтверждает передачу", async () => {
  const id = await create();
  await assign(id);
  await call(courier, "arrive", id);
  const { code } = await call(sender, "code", id, { stage: "pickup" });
  await pool.query(
    "UPDATE handover_codes SET expires_at=now()-interval '1 minute' WHERE shipment_id=$1",
    [id],
  );
  await assert.rejects(
    call(courier, "handover", id, { stage: "pickup", code }),
    /истек/,
  );
});
test("Повтор платежа и запроса не создает повторных операций", async () => {
  const id = await create();
  const key = randomUUID();
  const a = await call(sender, "pay", id, {}, key),
    b = await call(sender, "pay", id, {}, key);
  assert.deepEqual(a, b);
  await call(sender, "pay", id);
  assert.equal(
    (await pool.query("SELECT * FROM payments WHERE shipment_id=$1", [id]))
      .rowCount,
    1,
  );
  await assert.rejects(call(sender, "publish", id, {}, key), /другой операции/);
});
test("После забора отмена не стирает ответственность; возврат подтверждает отправитель", async () => {
  const id = await create();
  await pickup(id);
  await assert.rejects(call(sender, "cancel", id), /этап/);
  assert.equal((await getShipment(sender, id)).custodian_id, courier.id);
  await call(sender, "return", id);
  await call(courier, "returning", id);
  const { code } = await call(sender, "code", id, { stage: "return" });
  await call(courier, "handover", id, { stage: "return", code });
  assert.equal((await getShipment(sender, id)).status, "returned");
  assert.equal((await getShipment(sender, id)).custodian_id, sender.id);
});
test("Полный цикл доставки, получение, отзыв и блокировка выплаты спором", async () => {
  const id = await create();
  await atDestination(id);
  await call(courier, "ready", id);
  const { code } = await call(recipient, "code", id, { stage: "delivery" });
  await call(courier, "handover", id, { stage: "delivery", code });
  await call(recipient, "complete", id);
  assert.equal((await getShipment(sender, id)).status, "completed");
  await call(sender, "review", id, {
    targetId: courier.id,
    role: "courier",
    stars: 5,
    comment: "Все хорошо",
    reason: "care",
  });
  await assert.rejects(
    call(sender, "review", id, {
      targetId: courier.id,
      role: "courier",
      stars: 5,
      comment: "Повтор",
      reason: "care",
    }),
  );
  await call(recipient, "dispute", id, { reason: "Повреждение упаковки" });
  assert.equal((await getShipment(sender, id)).status, "completed");
  assert.equal(
    (await pool.query("SELECT status FROM payouts WHERE shipment_id=$1", [id]))
      .rows[0].status,
    "blocked",
  );
});
test("Доставка в ячейку отличается от получения; события устройства идемпотентны", async () => {
  const id = await create(sender, recipient, "locker");
  await atDestination(id);
  await call(courier, "locker", id, {
    operation: "reserve",
    endpoint: "destination",
    eventId: randomUUID(),
  });
  const eventId = randomUUID();
  await call(courier, "locker", id, {
    operation: "deposit",
    endpoint: "destination",
    eventId,
  });
  assert.equal((await getShipment(sender, id)).status, "awaiting_receipt");
  assert.equal(
    (
      await call(courier, "locker", id, {
        operation: "deposit",
        endpoint: "destination",
        eventId,
      })
    ).duplicate,
    true,
  );
  await call(recipient, "locker", id, {
    operation: "collect",
    endpoint: "destination",
    eventId: randomUUID(),
  });
  assert.equal((await getShipment(sender, id)).status, "received");
  await assert.rejects(
    call(recipient, "locker", id, {
      operation: "collect",
      endpoint: "destination",
      eventId: randomUUID(),
    }),
    /этап/,
  );
});
test("При потере связи последнее подтвержденное состояние сохраняется", async () => {
  const id = await create(sender, recipient, "locker");
  await atDestination(id);
  try {
    await pool.query(
      "UPDATE lockers SET connected=false WHERE id='fergana-locker'",
    );
    await assert.rejects(
      call(courier, "locker", id, {
        operation: "reserve",
        endpoint: "destination",
        eventId: randomUUID(),
      }),
      /не в сети/,
    );
    assert.equal((await getShipment(sender, id)).status, "destination_arrived");
  } finally {
    await pool.query(
      "UPDATE lockers SET connected=true WHERE id='fergana-locker'",
    );
  }
});
test("Пункт выдачи требует подтверждения ограниченного оператора", async () => {
  const id = await create(sender, recipient, "point", "Андижан");
  await atDestination(id);
  await call(courier, "locker", id, {
    operation: "reserve",
    endpoint: "destination",
    eventId: randomUUID(),
  });
  const pending = await call(courier, "locker", id, {
    operation: "deposit",
    endpoint: "destination",
    eventId: randomUUID(),
  });
  assert.equal(pending.pendingOperator, true);
  assert.equal((await getShipment(sender, id)).status, "destination_arrived");
  await assert.rejects(
    adminAction(other, "point.confirm", { requestId: pending.requestId }),
    /прав/,
  );
  await adminAction(operator, "point.confirm", {
    requestId: pending.requestId,
  });
  assert.equal((await getShipment(sender, id)).status, "awaiting_receipt");
});
test("Нет ячеек, ошибка двери, истечение хранения не меняют состояние доставки", async () => {
  const id = await create(sender, recipient, "locker");
  await atDestination(id);
  try {
    await pool.query(
      "UPDATE lockers SET fault='full' WHERE id='fergana-locker'",
    );
    await assert.rejects(
      call(courier, "locker", id, {
        operation: "reserve",
        endpoint: "destination",
        eventId: randomUUID(),
      }),
      /свободных/,
    );
    await pool.query(
      "UPDATE lockers SET fault='door' WHERE id='fergana-locker'",
    );
    await assert.rejects(
      call(courier, "locker", id, {
        operation: "reserve",
        endpoint: "destination",
        eventId: randomUUID(),
      }),
      /Дверь/,
    );
    await pool.query("UPDATE lockers SET fault=NULL WHERE id='fergana-locker'");
    await call(courier, "locker", id, {
      operation: "reserve",
      endpoint: "destination",
      eventId: randomUUID(),
    });
    await call(courier, "locker", id, {
      operation: "deposit",
      endpoint: "destination",
      eventId: randomUUID(),
    });
    await pool.query(
      "UPDATE reservations SET expires_at=now()-interval '1 hour' WHERE shipment_id=$1",
      [id],
    );
    await assert.rejects(
      call(recipient, "locker", id, {
        operation: "collect",
        endpoint: "destination",
        eventId: randomUUID(),
      }),
      /срок хранения/,
    );
    assert.equal((await getShipment(sender, id)).status, "awaiting_receipt");
  } finally {
    await pool.query("UPDATE lockers SET fault=NULL WHERE id='fergana-locker'");
  }
});
test("Production не подменяет неподключенные провайдеры демонстрацией", () => {
  process.env.APP_MODE = "production";
  assert.throws(assertDemo, /not configured/);
  process.env.APP_MODE = "demo";
  process.env.DEPLOYMENT_ENV = "production";
  assert.throws(assertDemo, /forbidden/);
  delete process.env.DEPLOYMENT_ENV;
});
test("Получатель-плательщик подтверждает согласие до оплаты и назначения", async () => {
  const data = { ...input(), payer: "recipient" };
  const s = await call(sender, "create", undefined, data);
  shipments.push(s.id);
  await call(sender, "publish", s.id);
  await assert.rejects(call(sender, "pay", s.id), /плательщик/);
  await assert.rejects(call(recipient, "pay", s.id), /согласие/);
  await call(recipient, "consent", s.id);
  await call(recipient, "pay", s.id);
  assert.equal((await getShipment(sender, s.id)).status, "published");
});
test("Знание номера заказа не позволяет привязать получателя; приглашение одноразовое", async () => {
  const data = { ...input(), recipient: "+998999999999" };
  const s = await call(sender, "create", undefined, data);
  shipments.push(s.id);
  await assert.rejects(
    call(other, "claim", undefined, { invite: s.id }),
    /недействительно/,
  );
  await call(recipient, "claim", undefined, { invite: s.invite });
  assert.equal((await getShipment(recipient, s.id)).recipient_id, recipient.id);
  await assert.rejects(
    call(other, "claim", undefined, { invite: s.invite }),
    /недействительно/,
  );
});
test("Непроверенный получатель не получает код, а точные координаты скрываются после завершения", async () => {
  const id = await create(sender, unverified);
  await assign(id);
  await call(courier, "arrive", id);
  const a = await call(sender, "code", id, { stage: "pickup" });
  await call(courier, "handover", id, { stage: "pickup", code: a.code });
  await call(courier, "transit", id);
  await call(courier, "location", id, {
    lat: 40.39,
    lng: 71.79,
    consent: true,
  });
  await call(courier, "destination", id);
  await call(courier, "ready", id);
  await assert.rejects(
    call(unverified, "code", id, { stage: "delivery" }),
    /личность/,
  );
  await call(unverified, "verify");
  const b = await call(unverified, "code", id, { stage: "delivery" });
  await call(courier, "handover", id, { stage: "delivery", code: b.code });
  await call(unverified, "complete", id);
  assert.equal((await getShipment(sender, id)).data.lastLocation, undefined);
  await assert.rejects(
    call(courier, "location", id, { lat: 40.39, lng: 71.79, consent: true }),
    /этап/,
  );
});
test("Все девять комбинаций точек проходят раздельные этапы передачи", async () => {
  for (const originKind of ["person", "point", "locker"])
    for (const destinationKind of ["person", "point", "locker"]) {
      const city = "Андижан";
      const originId =
        originKind === "point" ? "andijan-point" : "test-origin-" + prefix;
      const destinationId =
        destinationKind === "point"
          ? "andijan-point"
          : "test-destination-" + prefix;
      for (const id of [originId, destinationId])
        if (id.startsWith("test-")) {
          await pool.query(
            "INSERT INTO lockers(id,name,city,kind,operator_id) VALUES($1,$1,$2,$3,$4) ON CONFLICT DO NOTHING",
            [id, city, "locker", operator.id],
          );
          if (
            !(
              await pool.query(
                "SELECT 1 FROM compartments WHERE locker_id=$1",
                [id],
              )
            ).rowCount
          )
            for (let i = 0; i < 3; i++)
              await pool.query(
                "INSERT INTO compartments(locker_id,dimensions) VALUES($1,$2)",
                [id, JSON.stringify([60, 60, 60])],
              );
        }
      const data = input(recipient, destinationKind, city);
      data.origin = { ...data.origin, kind: originKind } as typeof data.origin;
      (data.origin as any).lockerId = originId;
      data.destination.lockerId = destinationId;
      const created = await call(sender, "create", undefined, data);
      const id = created.id;
      shipments.push(id);
      const hardware = async (u: User, operation: string, endpoint: string) => {
        const r = await call(u, "locker", id, {
          operation,
          endpoint,
          eventId: randomUUID(),
        });
        if (r.pendingOperator)
          await adminAction(operator, "point.confirm", {
            requestId: r.requestId,
          });
      };
      if (originKind !== "person") {
        await hardware(sender, "reserve", "origin");
        await hardware(sender, "deposit", "origin");
      }
      await assign(id);
      await call(courier, "arrive", id);
      if (originKind === "person") {
        const r = await call(sender, "code", id, { stage: "pickup" });
        await call(courier, "handover", id, { stage: "pickup", code: r.code });
      } else await hardware(courier, "collect", "origin");
      await call(courier, "transit", id);
      await call(courier, "destination", id);
      if (destinationKind === "person") {
        await call(courier, "ready", id);
        const r = await call(recipient, "code", id, { stage: "delivery" });
        await call(courier, "handover", id, {
          stage: "delivery",
          code: r.code,
        });
      } else {
        await hardware(courier, "reserve", "destination");
        await hardware(courier, "deposit", "destination");
        await hardware(recipient, "collect", "destination");
      }
      await call(recipient, "complete", id);
      assert.equal(
        (await getShipment(sender, id)).status,
        "completed",
        originKind + " → " + destinationKind,
      );
    }
});
test("Ответ с кодом хранится зашифрованным; ключ нельзя применить к другому телу запроса", async () => {
  const id = await create();
  await assign(id);
  await call(courier, "arrive", id);
  const key = randomUUID();
  const first = await call(sender, "code", id, { stage: "pickup" }, key);
  const cached = (
    await pool.query(
      "SELECT response FROM idempotency WHERE user_id=$1 AND key=$2",
      [sender.id, key],
    )
  ).rows[0].response;
  assert.equal(cached.v, 1);
  assert.equal(cached.code, undefined);
  assert.ok(cached.ciphertext);
  assert.deepEqual(
    await call(sender, "code", id, { stage: "pickup" }, key),
    first,
  );
  await assert.rejects(
    call(sender, "code", id, { stage: "delivery" }, key),
    /содержимого/,
  );
});
test("Сервер запрещает координаты вне настроенной зоны", async () => {
  await assert.rejects(
    call(sender, "create", undefined, {
      ...input(),
      origin: { ...input().origin, lat: 41.9, lng: 73.5 },
    }),
    /зоны/,
  );
});
test("Истекшая бронь освобождается для другого заказа; истекшее хранение сохраняет занятость ячейки", async () => {
  const a = await create(sender, recipient, "locker");
  await atDestination(a);
  await call(courier, "locker", a, {
    operation: "reserve",
    endpoint: "destination",
    eventId: randomUUID(),
  });
  await pool.query(
    "UPDATE reservations SET expires_at=now()-interval '1 minute' WHERE shipment_id=$1",
    [a],
  );
  const b = await create(sender, recipient, "locker");
  await atDestination(b);
  await call(courier, "locker", b, {
    operation: "reserve",
    endpoint: "destination",
    eventId: randomUUID(),
  });
  assert.equal(
    (
      await pool.query("SELECT status FROM reservations WHERE shipment_id=$1", [
        a,
      ])
    ).rows[0].status,
    "expired",
  );
  await call(courier, "locker", b, {
    operation: "deposit",
    endpoint: "destination",
    eventId: randomUUID(),
  });
  await pool.query(
    "UPDATE reservations SET expires_at=now()-interval '1 minute' WHERE shipment_id=$1",
    [b],
  );
  await call(recipient, "locker", b, {
    operation: "expire",
    endpoint: "destination",
    eventId: randomUUID(),
  });
  const reserved = (
    await pool.query("SELECT * FROM reservations WHERE shipment_id=$1", [b])
  ).rows[0];
  assert.equal(reserved.status, "storage_expired");
  await assert.rejects(
    pool.query(
      "INSERT INTO reservations(compartment_id,shipment_id,stage,expires_at) VALUES($1,$2,'destination',now()+interval '1 hour')",
      [reserved.compartment_id, a],
    ),
    /reservation_active_idx/,
  );
  assert.equal((await getShipment(sender, b)).status, "awaiting_receipt");
});
test("Отмена после помещения в исходную ячейку требует подтвержденного возврата отправителю", async () => {
  const data = input();
  data.origin = { ...data.origin, kind: "locker" } as typeof data.origin;
  (data.origin as any).lockerId = "fergana-locker";
  const s = await call(sender, "create", undefined, data);
  shipments.push(s.id);
  await call(sender, "locker", s.id, {
    operation: "reserve",
    endpoint: "origin",
    eventId: randomUUID(),
  });
  await call(sender, "locker", s.id, {
    operation: "deposit",
    endpoint: "origin",
    eventId: randomUUID(),
  });
  await assert.rejects(call(sender, "cancel", s.id), /возврат/);
  await call(sender, "locker", s.id, {
    operation: "reclaim",
    endpoint: "origin",
    eventId: randomUUID(),
  });
  assert.equal((await getShipment(sender, s.id)).custodian_id, sender.id);
  await call(sender, "cancel", s.id);
  assert.equal((await getShipment(sender, s.id)).status, "cancelled");
});
test("Команда двери не выполняется без действующей брони и подтвержденного наличия", async () => {
  const data = input();
  data.origin = { ...data.origin, kind: "locker" } as typeof data.origin;
  (data.origin as any).lockerId = "fergana-locker";
  const s = await call(sender, "create", undefined, data);
  shipments.push(s.id);
  await assign(s.id);
  await call(courier, "arrive", s.id);
  let opened = 0;
  const original = lockerProvider.open;
  lockerProvider.open = async (...args: [boolean, string | null]) => {
    opened++;
    return original(...args);
  };
  try {
    await assert.rejects(
      call(courier, "locker", s.id, {
        operation: "collect",
        endpoint: "origin",
        eventId: randomUUID(),
      }),
      /брони/,
    );
    assert.equal(opened, 0);
  } finally {
    lockerProvider.open = original;
  }
});
test("Отозванные права получателя блокируют ранее выпущенный код передачи", async () => {
  const id = await create();
  await atDestination(id);
  await call(courier, "ready", id);
  const { code } = await call(recipient, "code", id, { stage: "delivery" });
  try {
    await pool.query("UPDATE users SET restricted=true WHERE id=$1", [
      recipient.id,
    ]);
    await assert.rejects(
      call(courier, "handover", id, { stage: "delivery", code }),
      /личность/,
    );
    assert.equal((await getShipment(sender, id)).status, "awaiting_receipt");
  } finally {
    await pool.query("UPDATE users SET restricted=false WHERE id=$1", [
      recipient.id,
    ]);
  }
});
test("Сохраненное время поездки исключает заказы со сроком до отправления", async () => {
  const id = await create();
  await publish(id);
  await pool.query("INSERT INTO routes(user_id,data) VALUES($1,$2)", [
    other.id,
    JSON.stringify({
      city: "Фергана",
      departAt: new Date(Date.now() + 86400000).toISOString(),
    }),
  ]);
  const matches = await nearby(other, new URLSearchParams({ city: "Фергана" }));
  assert.equal(
    matches.some((x) => x.id === id),
    false,
  );
});
test("В production демонстрационный verified-статус не заменяет проверку MyID", async () => {
  const id = await create();
  await call(sender, "pay", id);
  process.env.APP_MODE = "production";
  try {
    await assert.rejects(call(sender, "publish", id), /реальная проверка MyID/);
    assert.equal((await getShipment(sender, id)).status, "draft");
  } finally {
    process.env.APP_MODE = "demo";
  }
});
