import {
  createDeliveryOrder,
  deliveryOrder,
  syncDeliveryState,
  courierPresence,
  executorPosition,
} from "./orders/delivery";
import { dispatchOrder, respondOrder, lockExecutor } from "./orders/matching";
import { changeOrderState } from "./orders/core";
import { codeDigest } from "./secure-cache";
import { encryptResponse, decryptResponse, canonical } from "./secure-cache";
import type { PoolClient } from "pg";
import { pool, transaction } from "./db";
import {
  AppError,
  hash,
  token,
  verified,
  requireRole,
  type User,
} from "./auth";
import { shipmentSchema } from "./schema";
import {
  identityProvider,
  paymentProvider,
  mapsProvider,
  lockerProvider,
  otpCode,
  assertDemo,
} from "./providers";
import { z } from "zod";
import { mobilityMutate } from "./mobility";
import {
  deliveryBookingSchema,
  deliveryInput,
  deliveryQuote,
} from "./delivery-booking";
export type Shipment = {
  id: string;
  sender_id: string;
  recipient_id: string | null;
  courier_id: string | null;
  status: string;
  custodian_id: string | null;
  location: string;
  data: any;
  payment_status: string;
  payout_status: string;
  dispute_status: string;
  recipient_consent: boolean;
  created_at: string;
  updated_at: string;
  invite_hash?: string;
};
const members = (s: Shipment) => [s.sender_id, s.recipient_id, s.courier_id];
export function participant(u: User, s: Shipment) {
  if (!members(s).includes(u.id))
    throw new AppError(403, "Вы не участник заказа");
}
function owner(u: User, s: Shipment) {
  if (u.id !== s.sender_id) throw new AppError(403, "Только отправитель");
}
function courier(u: User, s: Shipment) {
  if (u.id !== s.courier_id)
    throw new AppError(403, "Только назначенный курьер");
}
function status(s: Shipment, ...allowed: string[]) {
  if (!allowed.includes(s.status))
    throw new AppError(409, "Действие недоступно на текущем этапе");
}
async function shipment(db: PoolClient, id: string): Promise<Shipment> {
  z.uuid().parse(id);
  const r = await db.query("SELECT * FROM shipments WHERE id=$1 FOR UPDATE", [
    id,
  ]);
  if (!r.rowCount) throw new AppError(404, "Заказ не найден");
  return r.rows[0];
}
async function audit(
  db: PoolClient,
  u: User,
  action: string,
  id: string,
  detail: object = {},
) {
  await db.query(
    "INSERT INTO audit_logs(actor_id,action,entity_id,detail) VALUES($1,$2,$3,$4)",
    [u.id, action, id, JSON.stringify(detail)],
  );
}
async function event(db: PoolClient, u: User, s: Shipment, detail: string) {
  await db.query(
    "INSERT INTO tracking_events(shipment_id,actor_id,status,detail) VALUES($1,$2,$3,$4)",
    [s.id, u.id, s.status, detail],
  );
  await db.query("UPDATE shipments SET updated_at=now() WHERE id=$1", [s.id]);
  for (const id of members(s).filter(Boolean))
    await db.query(
      "INSERT INTO notifications(user_id,shipment_id,text) SELECT $1,$2,$3 FROM users WHERE id=$1 AND coalesce((profile->>'notifications')::boolean,true)",
      [id, s.id, detail],
    );
}
async function transition(
  db: PoolClient,
  u: User,
  s: Shipment,
  next: string,
  detail: string,
  custodian = s.custodian_id,
  location = s.location,
) {
  await syncDeliveryState(db, u, s, next, detail);
  await db.query(
    "UPDATE shipments SET status=$2,custodian_id=$3,location=$4 WHERE id=$1",
    [s.id, next, custodian, location],
  );
  s.status = next;
  s.custodian_id = custodian;
  s.location = location;
  await event(db, u, s, detail);
  await audit(db, u, "transition", s.id, { status: next });
}
export async function mutate(
  u: User,
  action: string,
  id: string | undefined,
  body: any,
  key: string,
) {
  if (!key || key.length > 100)
    throw new AppError(400, "Нужен Idempotency-Key");
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      u.id + key,
    ]);
    const old = await db.query(
      "SELECT action,response,request_hash FROM idempotency WHERE user_id=$1 AND key=$2",
      [u.id, key],
    );
    if (old.rowCount) {
      if (old.rows[0].action !== action + ":" + (id ?? ""))
        throw new AppError(409, "Ключ использован для другой операции");
      if (
        old.rows[0].request_hash !==
        (await codeDigest(
          canonical(body),
          u.id + ":" + action + ":" + (id ?? ""),
        ))
      )
        throw new AppError(
          409,
          "Ключ использован для другого содержимого запроса",
        );
      return decryptResponse(
        old.rows[0].response,
        u.id + ":" + key + ":" + action + ":" + (id ?? ""),
      );
    }
    const fresh = (await db.query("SELECT * FROM users WHERE id=$1", [u.id]))
      .rows[0];
    if (fresh.restricted) throw new AppError(403, "Аккаунт ограничен");
    u = fresh;
    const result = await execute(db, u, action, id, body);
    await db.query(
      "INSERT INTO idempotency(user_id,key,action,response,request_hash) VALUES($1,$2,$3,$4,$5)",
      [
        u.id,
        key,
        action + ":" + (id ?? ""),
        JSON.stringify(
          await encryptResponse(
            result,
            u.id + ":" + key + ":" + action + ":" + (id ?? ""),
          ),
        ),
        await codeDigest(
          canonical(body),
          u.id + ":" + action + ":" + (id ?? ""),
        ),
      ],
    );
    return result;
  });
}
export async function claimQuickDeliveries(db: PoolClient, u: User) {
  if (!u.phone_verified || u.restricted) return;
  const rows = (
    await db.query(
      "UPDATE shipments SET recipient_id=$1,invite_hash=NULL WHERE recipient_id IS NULL AND data->>'quickOrder'='true' AND data->>'recipient'=$2 AND sender_id<>$1 AND courier_id IS DISTINCT FROM $1 RETURNING id",
      [u.id, u.phone],
    )
  ).rows;
  for (const row of rows) await audit(db, u, "recipient.phone.claim", row.id);
}
async function execute(
  db: PoolClient,
  u: User,
  action: string,
  id: string | undefined,
  b: any,
): Promise<any> {
  if (action.startsWith("mobility."))
    return mobilityMutate(db, u, action.slice("mobility.".length), id, b);
  if (action === "delivery.presence") return courierPresence(db, u, b);
  if (
    ["delivery.dispatch", "delivery.accept", "delivery.reject"].includes(action)
  ) {
    const s = await shipment(db, z.uuid().parse(id));
    const order = await deliveryOrder(db, s.id);
    if (!order) throw new AppError(404, "Заказ не найден");
    if (action === "delivery.dispatch") {
      owner(u, s);
      return dispatchOrder(db, u, order);
    }
    const accept = action === "delivery.accept";
    await respondOrder(db, u, order, accept);
    if (accept) {
      await db.query(
        "INSERT INTO courier_offers VALUES($1,$2) ON CONFLICT DO NOTHING",
        [s.id, u.id],
      );
      const sender = (
        await db.query("SELECT * FROM users WHERE id=$1", [s.sender_id])
      ).rows[0];
      await execute(db, sender, "assign", s.id, { courierId: u.id });
    }
    return { ok: true, id: s.id };
  }
  if (action === "delivery.quote")
    return deliveryQuote(
      b,
      (await db.query("SELECT data FROM settings WHERE id=1 FOR SHARE")).rows[0]
        .data,
    );
  if (action === "delivery.book") {
    await verified(db, u);
    const input = deliveryBookingSchema.parse(b),
      quote = deliveryQuote(
        input,
        (await db.query("SELECT data FROM settings WHERE id=1 FOR SHARE"))
          .rows[0].data,
      );
    if (input.quotedPrice !== quote.price)
      throw new AppError(
        409,
        "Стоимость изменилась. Проверьте цену и повторите заказ.",
      );
    const created = await execute(
      db,
      u,
      "create",
      undefined,
      deliveryInput(input),
    );
    const createdPrice = (
      await db.query(
        "SELECT data->'price'->>'total' AS total FROM shipments WHERE id=$1",
        [created.id],
      )
    ).rows[0].total;
    if (Number(createdPrice) !== input.quotedPrice)
      throw new AppError(
        409,
        "Стоимость изменилась. Проверьте цену и повторите заказ.",
      );
    await db.query(
      "UPDATE shipments SET data=jsonb_set(data,'{quickOrder}','true') WHERE id=$1",
      [created.id],
    );
    await execute(db, u, "pay", created.id, {});
    await execute(db, u, "publish", created.id, {});
    if (process.env.DELIVERY_CORE_ENABLED !== "false")
      await createDeliveryOrder(db, u, await shipment(db, created.id), quote);
    return { ...created, status: "published", price: quote.price };
  }
  if (action === "verify") {
    const result = await identityProvider.verify({ userId: u.id, dob: u.dob });
    await db.query(
      "INSERT INTO identity_verifications(user_id,provider,reference,result) VALUES($1,$2,$3,$4)",
      [u.id, result.provider, result.reference, result.status],
    );
    await db.query("UPDATE users SET identity=$2 WHERE id=$1", [
      u.id,
      result.status,
    ]);
    await audit(db, u, "demo.identity", u.id);
    return result;
  }
  if (action === "profile") {
    const p = z
      .object({
        transport: z.enum(["walk", "bike", "scooter", "car"]),
        city: z.string(),
        accepting: z.boolean(),
        language: z.enum(["ru", "uz"]),
        notifications: z.boolean(),
        avatarId: z.uuid().nullable().optional(),
      })
      .parse(b);
    if (
      p.avatarId &&
      !(
        await db.query(
          "SELECT 1 FROM files WHERE id=$1 AND owner_id=$2 AND shipment_id IS NULL",
          [p.avatarId, u.id],
        )
      ).rowCount
    )
      throw new AppError(
        403,
        "Фото профиля должно принадлежать вам и не быть фото заказа",
      );
    await db.query("UPDATE users SET profile=$2 WHERE id=$1", [
      u.id,
      JSON.stringify(p),
    ]);
    return p;
  }
  if (action === "create") {
    const input = shipmentSchema.parse(b);
    const settings = (
      await db.query("SELECT data FROM settings WHERE id=1 FOR SHARE")
    ).rows[0].data;
    if (
      !settings.cities.includes(input.origin.city) ||
      !settings.cities.includes(input.destination.city)
    )
      throw new AppError(400, "Вне зоны обслуживания");
    for (const point of [input.origin, input.destination]) {
      const zone = settings.zones[point.city];
      if (
        !zone ||
        mapsProvider.estimate([zone.lat, zone.lng], [point.lat, point.lng]).km >
          zone.radiusKm
      )
        throw new AppError(400, "Координаты вне зоны обслуживания");
    }
    if (input.origin.city !== input.destination.city)
      throw new AppError(400, "MVP поддерживает доставку внутри одного города");
    if (
      input.weight > settings.maxWeight ||
      Math.max(...input.dimensions) > settings.maxDimension ||
      input.declaredValue > settings.maxDeclared ||
      settings.banned.includes(input.category)
    )
      throw new AppError(
        400,
        "Посылка превышает лимиты или содержит запрещенную категорию",
      );
    if (
      new Date(input.deliverBy) <= new Date(input.pickupAt) ||
      new Date(input.deliverBy) <= new Date()
    )
      throw new AppError(400, "Проверьте временные окна");
    for (const point of [input.origin, input.destination])
      if (point.kind !== "person") {
        const lr = await db.query("SELECT * FROM lockers WHERE id=$1", [
          point.lockerId,
        ]);
        if (
          !lr.rowCount ||
          lr.rows[0].kind !== point.kind ||
          lr.rows[0].city !== point.city
        )
          throw new AppError(400, "Неверная точка");
        if (lr.rows[0].lat != null) {
          point.lat = lr.rows[0].lat;
          point.lng = lr.rows[0].lng;
          point.address = lr.rows[0].address;
        }
        if (
          !(
            await db.query(
              "SELECT 1 FROM compartments WHERE locker_id=$1 AND (dimensions->>0)::int >=$2 AND (dimensions->>1)::int >=$3 AND (dimensions->>2)::int >=$4",
              [point.lockerId, ...input.dimensions],
            )
          ).rowCount
        )
          throw new AppError(400, "Не подходит размер ячейки");
      }
    for (const photo of input.photos)
      if (
        !(
          await db.query("SELECT 1 FROM files WHERE id=$1 AND owner_id=$2", [
            photo,
            u.id,
          ])
        ).rowCount
      )
        throw new AppError(403, "Чужое фото");
    const rec = (
      await db.query("SELECT id FROM users WHERE public_id=$1 OR phone=$1", [
        input.recipient,
      ])
    ).rows[0];
    if (rec?.id === u.id)
      throw new AppError(400, "Получатель должен быть другим пользователем");
    const estimate = mapsProvider.estimate(
      [input.origin.lat, input.origin.lng],
      [input.destination.lat, input.destination.lng],
    );
    const delivery = Math.round(
      (settings.base +
        estimate.km * settings.perKm +
        input.weight * settings.perKg) *
        (input.urgent ? 1.25 : 1),
    );
    const fee = Math.round(delivery * settings.commission);
    const data = {
      ...input,
      estimate,
      price: {
        delivery,
        fee,
        total: delivery + fee,
        courier: delivery,
        extra: 0,
      },
    };
    const invite = token();
    const s = (
      await db.query(
        "INSERT INTO shipments(sender_id,recipient_id,custodian_id,data,invite_hash) VALUES($1,$2,$1,$3,$4) RETURNING *",
        [u.id, rec?.id ?? null, JSON.stringify(data), hash(invite)],
      )
    ).rows[0];
    await db.query("INSERT INTO parcels(shipment_id,data) VALUES($1,$2)", [
      s.id,
      JSON.stringify({
        description: input.description,
        weight: input.weight,
        dimensions: input.dimensions,
        photos: input.photos,
      }),
    ]);
    for (const [endpoint, p] of [
      ["origin", input.origin],
      ["destination", input.destination],
    ] as const)
      await db.query(
        "INSERT INTO locations(shipment_id,kind,endpoint,data) VALUES($1,$2,$3,$4)",
        [s.id, p.kind, endpoint, JSON.stringify(p)],
      );
    await db.query("INSERT INTO conversations VALUES($1)", [s.id]);
    await db.query("INSERT INTO delivery_legs(shipment_id) VALUES($1)", [s.id]);
    for (const photo of input.photos)
      await db.query("UPDATE files SET shipment_id=$2 WHERE id=$1", [
        photo,
        s.id,
      ]);
    await event(db, u, s, "Создан черновик");
    return { id: s.id, invite };
  }
  if (action === "claim") {
    await verified(db, u);
    const r = await db.query("SELECT id FROM shipments WHERE invite_hash=$1", [
      hash(z.string().min(20).parse(b.invite)),
    ]);
    if (!r.rowCount) throw new AppError(404, "Приглашение недействительно");
    const s = await shipment(db, r.rows[0].id);
    if (s.recipient_id && s.recipient_id !== u.id)
      throw new AppError(403, "Приглашение предназначено другому получателю");
    if (u.id === s.sender_id || u.id === s.courier_id)
      throw new AppError(403, "Нельзя привязать эту роль");
    if (s.data.quickOrder && s.data.recipient !== u.phone)
      throw new AppError(
        403,
        "Приглашение предназначено другому номеру телефона",
      );
    await db.query(
      "UPDATE shipments SET recipient_id=$2,invite_hash=NULL WHERE id=$1",
      [s.id, u.id],
    );
    await audit(db, u, "recipient.claim", s.id);
    return { id: s.id };
  }
  if (action === "admin.settings") {
    requireRole(u, ["admin"]);
    const data = z
      .object({
        name: z.string().min(1).max(40),
        cities: z.array(z.string()).min(1),
        maxWeight: z.number().positive().max(100),
        maxDimension: z.number().positive().max(200),
        maxDeclared: z.number().int().positive(),
        base: z.number().int().positive().max(10000000),
        perKm: z.number().int().nonnegative().max(100000),
        perKg: z.number().int().nonnegative().max(100000),
        commission: z.number().min(0).max(1),
        banned: z.array(z.string()),
        zones: z.record(
          z.string(),
          z.object({
            lat: z.number().min(39).max(42),
            lng: z.number().min(69).max(74),
            radiusKm: z.number().positive().max(100),
          }),
        ),
      })
      .parse(b);
    await db.query("UPDATE settings SET data=$1 WHERE id=1", [
      JSON.stringify(data),
    ]);
    await audit(db, u, action, "settings");
    return data;
  }
  if (action === "admin.user") {
    requireRole(u, ["admin"]);
    const v = z.object({ id: z.uuid(), restricted: z.boolean() }).parse(b);
    if (v.id === u.id) throw new AppError(400, "Нельзя ограничить себя");
    await db.query("UPDATE users SET restricted=$2 WHERE id=$1", [
      v.id,
      v.restricted,
    ]);
    await audit(db, u, action, v.id, { restricted: v.restricted });
    return { ok: true };
  }
  if (action === "admin.locker") {
    requireRole(u, ["admin"]);
    const v = z
      .object({
        id: z.string(),
        connected: z.boolean(),
        fault: z.enum(["door", "full", "none"]),
      })
      .parse(b);
    await db.query("UPDATE lockers SET connected=$2,fault=$3 WHERE id=$1", [
      v.id,
      v.connected,
      v.fault === "none" ? null : v.fault,
    ]);
    await audit(db, u, action, v.id);
    return { ok: true };
  }
  if (!id) throw new AppError(400, "Нужен заказ");
  const s = await shipment(db, id);
  if (action === "offer") {
    if (await deliveryOrder(db, s.id))
      throw new AppError(
        409,
        "Доставка назначается автоматически. Выйдите на линию курьера.",
      );
    await verified(db, u);
    status(s, "published");
    if (
      s.sender_id === u.id ||
      s.recipient_id === u.id ||
      (s.data.quickOrder && s.data.recipient === u.phone)
    )
      throw new AppError(403, "Нельзя доставлять свой заказ");
    if (u.profile.accepting !== true)
      throw new AppError(400, "Включите прием заказов");
    if (u.profile.transport === "walk" && s.data.weight > 5)
      throw new AppError(400, "Для такого веса нужен другой транспорт");
    await db.query(
      "INSERT INTO courier_offers VALUES($1,$2) ON CONFLICT DO NOTHING",
      [s.id, u.id],
    );
    await audit(db, u, action, s.id);
    await db.query(
      "INSERT INTO notifications(user_id,shipment_id,text) SELECT $1,$2,$3 FROM users WHERE id=$1 AND coalesce((profile->>'notifications')::boolean,true)",
      [s.sender_id, s.id, "Новый отклик курьера"],
    );
    if (s.data.quickOrder) {
      const sender = (
        await db.query("SELECT * FROM users WHERE id=$1", [s.sender_id])
      ).rows[0];
      if (!sender.restricted)
        await execute(db, sender, "assign", s.id, { courierId: u.id });
    }
    return { ok: true };
  }
  if (action === "assign") {
    owner(u, s);
    await verified(db, u);
    status(s, "published");
    if (
      s.payment_status !== "paid" ||
      (!s.recipient_id && !s.data.quickOrder) ||
      (s.data.payer === "recipient" && !s.recipient_consent)
    )
      throw new AppError(409, "Требуются получатель, согласие и оплата");
    const target = z.uuid().parse(b.courierId);
    const core = await deliveryOrder(db, s.id);
    if (core && (core.status !== "assigned" || core.provider_id !== target))
      throw new AppError(409, "Сначала исполнитель должен принять предложение");
    if (!(await lockExecutor(db, target, s.id, !!core)))
      throw new AppError(409, "Исполнитель уже занят");
    if (target === s.sender_id || target === s.recipient_id)
      throw new AppError(403, "Нельзя назначить участника курьером");
    const offer = await db.query(
      "SELECT u.* FROM courier_offers o JOIN users u ON u.id=o.user_id WHERE o.shipment_id=$1 AND o.user_id=$2",
      [id, target],
    );
    if (!offer.rowCount) throw new AppError(400, "Нет отклика");
    await verified(db, offer.rows[0]);
    if (!offer.rows[0].profile.accepting)
      throw new AppError(409, "Курьер больше не принимает заказы");
    if (offer.rows[0].profile.transport === "walk" && s.data.weight > 5)
      throw new AppError(400, "Вес не подходит транспорту курьера");
    await db.query("UPDATE shipments SET courier_id=$2 WHERE id=$1", [
      id,
      target,
    ]);
    s.courier_id = target;
    await db.query("INSERT INTO assignments VALUES($1,$2)", [id, target]);
    await db.query(
      "UPDATE delivery_legs SET courier_id=$2,status=$3 WHERE shipment_id=$1",
      [id, target, "assigned"],
    );
    await transition(db, u, s, "assigned", "Курьер назначен");
    return { ok: true };
  }
  participant(u, s);
  if (action === "tracking.link") {
    owner(u, s);
    const secret = token();
    await db.query("UPDATE shipments SET tracking_hash=$2 WHERE id=$1", [
      id,
      hash(secret),
    ]);
    return { token: secret };
  }
  if (action === "invite") {
    owner(u, s);
    if (s.recipient_id) throw new AppError(409, "Получатель уже привязан");
    const invite = token();
    await db.query("UPDATE shipments SET invite_hash=$2 WHERE id=$1", [
      id,
      hash(invite),
    ]);
    return { invite };
  }
  if (action === "publish") {
    owner(u, s);
    await verified(db, u);
    status(s, "draft", "awaiting_payment");
    if (!s.recipient_id && !s.data.quickOrder)
      throw new AppError(
        409,
        "Получатель должен зарегистрироваться по приглашению",
      );
    await transition(
      db,
      u,
      s,
      s.payment_status === "paid" ? "published" : "awaiting_payment",
      s.payment_status === "paid" ? "Заказ опубликован" : "Ожидается оплата",
    );
    return { ok: true };
  }
  if (action === "consent") {
    if (u.id !== s.recipient_id) throw new AppError(403, "Только получатель");
    await verified(db, u);
    await db.query("UPDATE shipments SET recipient_consent=true WHERE id=$1", [
      id,
    ]);
    await event(db, u, s, "Получатель согласился оплатить");
    return { ok: true };
  }
  if (action === "pay") {
    await verified(db, u);
    status(s, "draft", "awaiting_payment", "published");
    if (u.id !== (s.data.payer === "sender" ? s.sender_id : s.recipient_id))
      throw new AppError(403, "Только плательщик");
    if (s.data.payer === "recipient" && !s.recipient_consent)
      throw new AppError(409, "Сначала подтвердите согласие");
    const paid = await paymentProvider.pay("demo:" + s.id, s.data.price.total);
    await db.query(
      "INSERT INTO payments(shipment_id,provider_ref,amount,status) VALUES($1,$2,$3,$4) ON CONFLICT(shipment_id) DO NOTHING",
      [id, paid.reference, s.data.price.total, "paid"],
    );
    await db.query("UPDATE shipments SET payment_status='paid' WHERE id=$1", [
      id,
    ]);
    if (s.status === "awaiting_payment")
      await transition(
        db,
        u,
        s,
        "published",
        "Демо-оплата подтверждена, заказ опубликован",
      );
    await audit(db, u, "demo.pay", s.id);
    return paid;
  }
  if (action === "depart") {
    courier(u, s);
    status(s, "assigned");
    const core = await deliveryOrder(db, s.id);
    if (!core)
      throw new AppError(409, "Для этого заказа отдельный выезд не требуется");
    await changeOrderState(
      db,
      u,
      core,
      "en_route_to_pickup",
      "Курьер выехал за посылкой",
    );
    await event(db, u, s, "Курьер выехал за посылкой");
    return { ok: true };
  }
  if (action === "arrive") {
    courier(u, s);
    status(s, "assigned");
    await transition(db, u, s, "pickup_arrived", "Курьер прибыл на забор");
    return { ok: true };
  }
  if (action === "code") {
    await verified(db, u);
    const stage = z.enum(["pickup", "delivery", "return"]).parse(b.stage);
    if (stage === "pickup") {
      owner(u, s);
      status(s, "pickup_arrived");
    } else if (stage === "delivery") {
      if (u.id !== s.recipient_id) throw new AppError(403, "Только получатель");
      status(s, "awaiting_receipt");
    } else {
      owner(u, s);
      status(s, "returning");
    }
    await db.query(
      "UPDATE handover_codes SET used_at=now() WHERE shipment_id=$1 AND stage=$2 AND used_at IS NULL",
      [id, stage],
    );
    const code = otpCode();
    await db.query(
      "INSERT INTO handover_codes(shipment_id,stage,issuer_id,hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes')",
      [
        id,
        stage,
        u.id,
        await codeDigest(code, "handover:" + id + ":" + stage + ":" + u.id),
      ],
    );
    await audit(db, u, "handover.code.issue", s.id, { stage });
    return { code, expiresIn: 300, stage };
  }
  if (action === "handover") {
    if (
      (b.stage === "pickup" && s.data.origin.kind !== "person") ||
      (b.stage === "delivery" && s.data.destination.kind !== "person")
    )
      throw new AppError(409, "Передача в точке требует подтверждения изъятия");
    courier(u, s);
    await verified(db, u);
    const v = z
      .object({
        stage: z.enum(["pickup", "delivery", "return"]),
        code: z.string().regex(/^\d{6}$/),
      })
      .parse(b);
    status(
      s,
      ...(v.stage === "pickup"
        ? ["pickup_arrived"]
        : v.stage === "delivery"
          ? ["awaiting_receipt"]
          : ["returning"]),
    );
    const c = (
      await db.query(
        "SELECT * FROM handover_codes WHERE shipment_id=$1 AND stage=$2 AND used_at IS NULL ORDER BY expires_at DESC LIMIT 1 FOR UPDATE",
        [id, v.stage],
      )
    ).rows[0];
    if (!c || new Date(c.expires_at).getTime() < Date.now() || c.attempts >= 5)
      throw new AppError(409, "Код истек или заблокирован");
    if (
      c.hash !==
      (await codeDigest(
        v.code,
        "handover:" + id + ":" + v.stage + ":" + c.issuer_id,
      ))
    ) {
      await db.query(
        "UPDATE handover_codes SET attempts=attempts+1 WHERE id=$1",
        [c.id],
      );
      return { error: "Неверный код", attemptsRemaining: 4 - c.attempts };
    }
    const issuer = v.stage === "delivery" ? s.recipient_id : s.sender_id;
    if (c.issuer_id !== issuer) throw new AppError(403, "Неверный участник");
    await verified(db, { id: c.issuer_id } as User);
    const end =
      v.stage === "delivery"
        ? s.recipient_id
        : v.stage === "return"
          ? s.sender_id
          : s.courier_id;
    await db.query("UPDATE handover_codes SET used_at=now() WHERE id=$1", [
      c.id,
    ]);
    await db.query(
      "INSERT INTO handovers(shipment_id,stage,from_id,to_id) VALUES($1,$2,$3,$4)",
      [id, v.stage, s.custodian_id, end],
    );
    await transition(
      db,
      u,
      s,
      v.stage === "pickup"
        ? "picked_up"
        : v.stage === "delivery"
          ? "received"
          : "returned",
      "Передача подтверждена одноразовым кодом",
      end,
      v.stage === "pickup"
        ? "courier"
        : v.stage === "delivery"
          ? "recipient"
          : "origin",
    );
    return { ok: true };
  }
  if (action === "transit") {
    courier(u, s);
    status(s, "picked_up");
    await transition(db, u, s, "in_transit", "Посылка в пути");
    return { ok: true };
  }
  if (action === "destination") {
    courier(u, s);
    status(s, "in_transit");
    await transition(
      db,
      u,
      s,
      "destination_arrived",
      "Курьер прибыл в точку назначения",
    );
    return { ok: true };
  }
  if (action === "ready") {
    courier(u, s);
    status(s, "destination_arrived");
    if (s.data.destination.kind !== "person")
      throw new AppError(409, "Сначала подтвердите помещение в точку");
    await transition(db, u, s, "awaiting_receipt", "Ожидается код получателя");
    return { ok: true };
  }
  if (action === "complete") {
    if (u.id !== s.recipient_id) throw new AppError(403, "Только получатель");
    await verified(db, u);
    status(s, "received");
    await transition(db, u, s, "completed", "Получатель подтвердил завершение");
    await db.query("UPDATE delivery_legs SET status=$2 WHERE shipment_id=$1", [
      id,
      "completed",
    ]);
    await db.query(
      "INSERT INTO payouts(shipment_id,user_id,amount,status) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [
        id,
        s.courier_id,
        s.data.price.courier,
        s.dispute_status === "open" ? "blocked" : "pending",
      ],
    );
    return { ok: true };
  }
  if (action === "cancel") {
    owner(u, s);
    status(
      s,
      "draft",
      "awaiting_payment",
      "published",
      "assigned",
      "pickup_arrived",
    );
    if (s.location !== "origin" && s.custodian_id !== u.id)
      throw new AppError(
        409,
        "Сначала подтвердите возврат посылки из точки отправления",
      );
    await transition(db, u, s, "cancelled", "Отправитель отменил заказ");
    await db.query(
      "UPDATE reservations SET status='cancelled' WHERE shipment_id=$1 AND status='reserved'",
      [id],
    );
    if (s.payment_status === "paid") {
      await db.query(
        "INSERT INTO refunds(shipment_id,amount,status) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [id, s.data.price.total, "pending"],
      );
      await db.query(
        "UPDATE shipments SET payment_status='refund_pending' WHERE id=$1",
        [id],
      );
    }
    return { ok: true };
  }
  if (action === "decline") {
    courier(u, s);
    status(s, "assigned", "pickup_arrived");
    await db.query("DELETE FROM assignments WHERE shipment_id=$1", [id]);
    await db.query(
      "DELETE FROM courier_offers WHERE shipment_id=$1 AND user_id=$2",
      [id, u.id],
    );
    await db.query("UPDATE shipments SET courier_id=NULL WHERE id=$1", [id]);
    s.courier_id = null;
    await transition(db, u, s, "published", "Курьер отказался до забора");
    return { ok: true };
  }
  if (action === "failure") {
    courier(u, s);
    status(s, "in_transit", "destination_arrived", "awaiting_receipt");
    const reason = z.string().min(3).max(500).parse(b.reason);
    await transition(
      db,
      u,
      s,
      "delivery_failed",
      "Неудачная доставка: " + reason,
    );
    return { ok: true };
  }
  if (action === "return") {
    owner(u, s);
    status(
      s,
      "picked_up",
      "in_transit",
      "destination_arrived",
      "awaiting_receipt",
      "delivery_failed",
    );
    await transition(
      db,
      u,
      s,
      "return_agreed",
      "Отправитель согласовал возврат",
    );
    return { ok: true };
  }
  if (action === "returning") {
    courier(u, s);
    status(s, "return_agreed");
    await transition(db, u, s, "returning", "Курьер возвращает посылку");
    return { ok: true };
  }
  if (action === "message") {
    const v = z
      .object({ text: z.string().max(2000), photoId: z.uuid().optional() })
      .refine((x) => x.text.trim() || x.photoId)
      .parse(b);
    const recent = await db.query(
      "SELECT count(*) FROM messages WHERE user_id=$1 AND created_at>now()-interval '1 minute'",
      [u.id],
    );
    if (Number(recent.rows[0].count) >= 20)
      throw new AppError(429, "Слишком много сообщений");
    if (v.photoId) {
      const f = await db.query(
        "SELECT 1 FROM files WHERE id=$1 AND owner_id=$2 AND shipment_id=$3",
        [v.photoId, u.id, id],
      );
      if (!f.rowCount) throw new AppError(403, "Нет доступа к фото");
    }
    await db.query(
      "INSERT INTO messages(shipment_id,user_id,text,photo_id) VALUES($1,$2,$3,$4)",
      [id, u.id, v.text, v.photoId ?? null],
    );
    return { ok: true };
  }
  if (action === "report") {
    const v = z
      .object({
        messageId: z.number().int(),
        reason: z.string().min(3).max(500),
      })
      .parse(b);
    if (
      !(
        await db.query(
          "SELECT 1 FROM messages WHERE id=$1 AND shipment_id=$2",
          [v.messageId, id],
        )
      ).rowCount
    )
      throw new AppError(404, "Нет сообщения");
    await db.query(
      "INSERT INTO reports(author_id,message_id,reason) VALUES($1,$2,$3)",
      [u.id, v.messageId, v.reason],
    );
    return { ok: true };
  }
  if (action === "dispute") {
    status(
      s,
      "assigned",
      "pickup_arrived",
      "picked_up",
      "in_transit",
      "destination_arrived",
      "awaiting_receipt",
      "received",
      "completed",
      "delivery_failed",
      "return_agreed",
      "returning",
      "returned",
    );
    if (s.dispute_status === "open") throw new AppError(409, "Спор уже открыт");
    const v = z
      .object({
        reason: z.string().min(3).max(1000),
        evidence: z.array(z.uuid()).max(6).default([]),
      })
      .parse(b);
    for (const f of v.evidence)
      if (
        !(
          await db.query(
            "SELECT 1 FROM files WHERE id=$1 AND shipment_id=$2 AND owner_id=$3",
            [f, id, u.id],
          )
        ).rowCount
      )
        throw new AppError(403, "Чужое доказательство");
    await db.query(
      "INSERT INTO disputes(shipment_id,author_id,reason,evidence) VALUES($1,$2,$3,$4)",
      [id, u.id, v.reason, JSON.stringify(v.evidence)],
    );
    await db.query(
      "UPDATE shipments SET dispute_status='open',payout_status=CASE WHEN payout_status='paid' THEN payout_status ELSE 'blocked' END WHERE id=$1",
      [id],
    );
    await db.query(
      "UPDATE payouts SET status='blocked' WHERE shipment_id=$1 AND status<>'paid'",
      [id],
    );
    await event(
      db,
      u,
      s,
      "Открыт спор. Невыплаченное вознаграждение заблокировано",
    );
    await audit(db, u, action, s.id);
    return { ok: true };
  }
  if (action === "review") {
    status(s, "completed", "returned");
    const v = z
      .object({
        targetId: z.uuid(),
        role: z.enum(["sender", "courier", "recipient"]),
        stars: z.number().int().min(1).max(5),
        comment: z.string().max(1000),
        reason: z.enum(["punctuality", "communication", "packaging", "care"]),
      })
      .parse(b);
    const roleId =
      v.role === "courier"
        ? s.courier_id
        : v.role === "sender"
          ? s.sender_id
          : s.recipient_id;
    if (
      v.targetId !== roleId ||
      v.targetId === u.id ||
      (u.id !== s.courier_id && v.role !== "courier")
    )
      throw new AppError(403, "Недопустимый отзыв");
    await db.query(
      "INSERT INTO reviews(shipment_id,author_id,target_id,role,stars,comment,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, u.id, v.targetId, v.role, v.stars, v.comment, v.reason],
    );
    await db.query(
      "UPDATE reviews a SET publish_at=now() WHERE a.shipment_id=$1 AND EXISTS(SELECT 1 FROM reviews b WHERE b.shipment_id=a.shipment_id AND b.author_id=a.target_id AND b.target_id=a.author_id)",
      [id],
    );
    return { ok: true };
  }
  if (action === "location") {
    courier(u, s);
    status(
      s,
      "picked_up",
      "in_transit",
      "destination_arrived",
      "awaiting_receipt",
      "returning",
    );
    const v = z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        consent: z.literal(true),
      })
      .parse(b);
    await db.query(
      "UPDATE shipments SET data=jsonb_set(data,'{lastLocation}',$2::jsonb),updated_at=now() WHERE id=$1",
      [id, JSON.stringify({ ...v, at: new Date().toISOString() })],
    );
    return { ok: true };
  }
  if (action === "locker") {
    return lockerAction(db, u, s, b);
  }
  throw new AppError(404, "Неизвестное действие");
}
async function lockerAction(
  db: PoolClient,
  u: User,
  s: Shipment,
  b: any,
  operatorConfirmed = false,
) {
  assertDemo();
  await verified(db, u);
  const v = z
    .object({
      operation: z.enum(["reserve", "deposit", "collect", "expire", "reclaim"]),
      endpoint: z.enum(["origin", "destination"]),
      eventId: z.string().min(8).max(100),
    })
    .parse(b);
  if (v.operation === "reclaim" && v.endpoint !== "origin")
    throw new AppError(400, "Забрать назад можно только из точки отправления");
  const point = s.data[v.endpoint];
  if (point.kind === "person") throw new AppError(400, "Это адрес человека");
  const l = (
    await db.query("SELECT * FROM lockers WHERE id=$1 FOR UPDATE", [
      point.lockerId,
    ])
  ).rows[0];
  if (!l) throw new AppError(404, "Точка не найдена");
  const old = await db.query("SELECT * FROM device_events WHERE event_id=$1", [
    v.eventId,
  ]);
  if (old.rowCount) {
    if (
      old.rows[0].shipment_id !== s.id ||
      old.rows[0].locker_id !== l.id ||
      old.rows[0].kind !== v.operation
    )
      throw new AppError(409, "Чужое событие");
    return { duplicate: true, result: old.rows[0].result };
  }
  if (v.endpoint === "origin") {
    if (v.operation === "collect") courier(u, s);
    else owner(u, s);
    status(
      s,
      ...(v.operation === "collect"
        ? ["pickup_arrived"]
        : [
            "draft",
            "awaiting_payment",
            "published",
            "assigned",
            "pickup_arrived",
          ]),
    );
  } else {
    if (v.operation === "collect" || v.operation === "expire") {
      if (u.id !== s.recipient_id) throw new AppError(403, "Только получатель");
      status(s, "awaiting_receipt");
    } else {
      courier(u, s);
      status(s, "destination_arrived");
    }
  }
  if (
    l.kind === "point" &&
    v.operation !== "reserve" &&
    v.operation !== "expire" &&
    !operatorConfirmed
  ) {
    const request = (
      await db.query(
        "INSERT INTO point_requests(shipment_id,locker_id,actor_id,operation,endpoint,event_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id",
        [s.id, l.id, u.id, v.operation, v.endpoint, v.eventId],
      )
    ).rows[0];
    return { pendingOperator: true, requestId: request?.id };
  }
  if (v.operation !== "expire") {
    if (!l.connected)
      throw new AppError(
        409,
        "Постамат не в сети. Последнее подтвержденное состояние сохранено",
      );
    if (l.fault === "door") throw new AppError(409, "Дверь не открылась");
  }
  const open = async () => {
    try {
      await lockerProvider.open(l.connected, l.fault);
    } catch (e) {
      throw new AppError(409, (e as Error).message);
    }
  };
  await db.query(
    "UPDATE reservations r SET status='expired' FROM compartments c WHERE r.compartment_id=c.id AND c.locker_id=$1 AND r.status='reserved' AND r.expires_at<now()",
    [l.id],
  );
  await db.query(
    "UPDATE reservations SET status='expired' WHERE shipment_id=$1 AND stage=$2 AND status='reserved' AND expires_at<now()",
    [s.id, v.endpoint],
  );
  let r = (
    await db.query(
      "SELECT r.*,c.dimensions FROM reservations r JOIN compartments c ON c.id=r.compartment_id WHERE r.shipment_id=$1 AND r.stage=$2 AND r.status IN ('reserved','deposited','storage_expired') FOR UPDATE OF r",
      [s.id, v.endpoint],
    )
  ).rows[0];
  if (v.operation === "reserve") {
    if (r) return { reservation: r.id };
    if (l.fault === "full") throw new AppError(409, "Нет свободных ячеек");
    const c = (
      await db.query(
        "SELECT c.* FROM compartments c WHERE c.locker_id=$1 AND c.available AND (dimensions->>0)::int >=$2 AND (dimensions->>1)::int >=$3 AND (dimensions->>2)::int >=$4 AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.compartment_id=c.id AND r.status IN ('reserved','deposited','storage_expired')) LIMIT 1 FOR UPDATE OF c SKIP LOCKED",
        [l.id, ...s.data.dimensions],
      )
    ).rows[0];
    if (!c) throw new AppError(409, "Нет свободных ячеек");
    r = (
      await db.query(
        "INSERT INTO reservations(compartment_id,shipment_id,stage,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes') RETURNING *",
        [c.id, s.id, v.endpoint],
      )
    ).rows[0];
  } else {
    if (!r) throw new AppError(409, "Нет действующей брони");
    if (v.operation === "expire") {
      if (new Date(r.expires_at) > new Date())
        throw new AppError(409, "Срок хранения еще не истек");
      await db.query(
        "UPDATE reservations SET status='storage_expired' WHERE id=$1",
        [r.id],
      );
      await event(
        db,
        u,
        s,
        "Истек срок хранения. Необходим возврат через поддержку",
      );
    } else if (v.operation === "reclaim") {
      if (r.status !== "deposited" || new Date(r.expires_at) < new Date())
        throw new AppError(409, "Для просроченной посылки нужна поддержка");
      await open();
      await db.query("UPDATE reservations SET status='collected' WHERE id=$1", [
        r.id,
      ]);
      await db.query(
        "INSERT INTO handovers(shipment_id,stage,from_id,to_id) VALUES($1,$2,NULL,$3)",
        [s.id, "origin.reclaim", u.id],
      );
      await db.query(
        "UPDATE shipments SET custodian_id=$2,location='origin' WHERE id=$1",
        [s.id, u.id],
      );
      s.custodian_id = u.id;
      s.location = "origin";
      await event(
        db,
        u,
        s,
        "Отправитель подтвердил возврат из точки до забора курьером",
      );
    } else if (v.operation === "deposit") {
      if (r.status !== "reserved")
        throw new AppError(409, "Посылка уже помещена");
      await open();
      await db.query(
        "UPDATE reservations SET status='deposited',expires_at=now()+interval '48 hours' WHERE id=$1",
        [r.id],
      );
      if (v.endpoint === "origin") {
        await db.query(
          "UPDATE shipments SET custodian_id=NULL,location=$2 WHERE id=$1",
          [s.id, l.id],
        );
        s.custodian_id = null;
        s.location = l.id;
        await event(
          db,
          u,
          s,
          "Симулятор: наличие посылки подтверждено отдельно от открытия двери",
        );
      } else
        await transition(
          db,
          u,
          s,
          "awaiting_receipt",
          "Симулятор: посылка помещена в конечную точку, получение еще не подтверждено",
          null,
          l.id,
        );
      await db.query(
        "INSERT INTO handovers(shipment_id,stage,from_id,to_id) VALUES($1,$2,$3,NULL)",
        [s.id, v.endpoint + ".deposit", u.id],
      );
    } else {
      if (r.status !== "deposited")
        throw new AppError(409, "Нет подтвержденного наличия посылки");
      if (new Date(r.expires_at) < new Date())
        throw new AppError(409, "Истек срок хранения. Обратитесь в поддержку");
      await open();
      await db.query("UPDATE reservations SET status='collected' WHERE id=$1", [
        r.id,
      ]);
      await db.query(
        "INSERT INTO handovers(shipment_id,stage,from_id,to_id) VALUES($1,$2,NULL,$3)",
        [s.id, v.endpoint + ".collect", u.id],
      );
      await transition(
        db,
        u,
        s,
        v.endpoint === "origin" ? "picked_up" : "received",
        "Симулятор: уполномоченный участник подтвердил изъятие посылки",
        u.id,
        v.endpoint === "origin" ? "courier" : "recipient",
      );
    }
  }
  await db.query(
    "INSERT INTO device_events(event_id,locker_id,shipment_id,kind,result) VALUES($1,$2,$3,$4,$5)",
    [v.eventId, l.id, s.id, v.operation, "confirmed"],
  );
  await audit(db, u, "demo.locker." + v.operation, s.id, {
    endpoint: v.endpoint,
  });
  return { ok: true, reservation: r?.id, simulated: true };
}
export async function adminAction(u: User, action: string, b: any) {
  return transaction(async (db) => {
    if (action === "moderate") {
      requireRole(u, ["admin", "support"]);
      const v = z.object({ reportId: z.uuid(), hide: z.boolean() }).parse(b);
      const r = (
        await db.query("SELECT * FROM reports WHERE id=$1 FOR UPDATE", [
          v.reportId,
        ])
      ).rows[0];
      if (!r) throw new AppError(404, "Жалоба не найдена");
      await db.query("UPDATE messages SET hidden=$2 WHERE id=$1", [
        r.message_id,
        v.hide,
      ]);
      await db.query("UPDATE reports SET status='resolved' WHERE id=$1", [
        r.id,
      ]);
      await audit(db, u, action, r.id, { hide: v.hide });
      return { ok: true };
    }
    if (action === "point.confirm") {
      requireRole(u, ["operator", "admin"]);
      const r = (
        await db.query(
          "SELECT r.*,l.operator_id FROM point_requests r JOIN lockers l ON l.id=r.locker_id WHERE r.id=$1 FOR UPDATE OF r",
          [z.uuid().parse(b.requestId)],
        )
      ).rows[0];
      if (!r || r.status !== "pending")
        throw new AppError(409, "Нет ожидающей операции");
      if (u.role !== "admin" && r.operator_id !== u.id)
        throw new AppError(403, "Не ваш пункт");
      const s = await shipment(db, r.shipment_id);
      const actor = (
        await db.query("SELECT * FROM users WHERE id=$1", [r.actor_id])
      ).rows[0];
      const result = await lockerAction(
        db,
        actor,
        s,
        { operation: r.operation, endpoint: r.endpoint, eventId: r.event_id },
        true,
      );
      await db.query(
        "UPDATE point_requests SET status='confirmed',confirmed_at=now() WHERE id=$1",
        [r.id],
      );
      await audit(db, u, action, s.id, { requestId: r.id });
      return result;
    }
    requireRole(
      u,
      action === "payout" || action === "refund"
        ? ["admin", "finance"]
        : ["admin", "support"],
    );
    const s = await shipment(db, z.uuid().parse(b.shipmentId));
    if (action === "resolve") {
      requireRole(u, ["admin"]);
      const resolution = z.string().min(5).max(1000).parse(b.resolution);
      if (s.dispute_status !== "open")
        throw new AppError(409, "Нет открытого спора");
      await db.query(
        "UPDATE disputes SET status='resolved',resolution=$2 WHERE shipment_id=$1 AND status='open'",
        [s.id, resolution],
      );
      await db.query(
        "UPDATE shipments SET dispute_status='resolved',payout_status=CASE WHEN payout_status='blocked' THEN 'pending' ELSE payout_status END WHERE id=$1",
        [s.id],
      );
      await db.query(
        "UPDATE payouts SET status='pending' WHERE shipment_id=$1 AND status='blocked'",
        [s.id],
      );
      await event(db, u, s, "Спор решен: " + resolution);
    } else if (action === "payout") {
      assertDemo();
      status(s, "completed");
      if (s.dispute_status === "open")
        throw new AppError(409, "Спор блокирует выплату");
      await db.query(
        "UPDATE payouts SET status='paid' WHERE shipment_id=$1 AND status='pending'",
        [s.id],
      );
      await db.query(
        "UPDATE shipments SET payout_status='paid' WHERE id=$1 AND payout_status='pending'",
        [s.id],
      );
    } else if (action === "refund") {
      assertDemo();
      if (s.payment_status !== "refund_pending")
        throw new AppError(409, "Нет возврата к исполнению");
      await db.query(
        "UPDATE refunds SET status='refunded' WHERE shipment_id=$1 AND status='pending'",
        [s.id],
      );
      await db.query(
        "UPDATE shipments SET payment_status='refunded' WHERE id=$1",
        [s.id],
      );
    } else throw new AppError(404, "Неизвестное действие");
    await audit(db, u, "admin." + action, s.id);
    return { ok: true };
  });
}
export async function getShipment(u: User, id: string) {
  return transaction(async (db) => {
    const s = await shipment(db, id);
    participant(u, s);
    delete s.invite_hash;
    delete (s as any).tracking_hash;
    const active = !["completed", "returned", "cancelled"].includes(s.status);
    if (!active) delete s.data.lastLocation;
    const query = async (sql: string) => (await db.query(sql, [id])).rows;
    const core = await deliveryOrder(db, s.id);
    return {
      ...s,
      orderState: core?.state ?? null,
      orderEngine: core?.engine_version ?? 0,
      executorPosition: s.courier_id
        ? await executorPosition(db, s.courier_id, "delivery", active)
        : null,
      events: await query(
        "SELECT e.*,u.name FROM tracking_events e LEFT JOIN users u ON u.id=e.actor_id WHERE shipment_id=$1 ORDER BY e.id",
      ),
      messages: await query(
        `SELECT m.id,m.shipment_id,m.user_id,CASE WHEN m.hidden THEN 'Сообщение скрыто модератором' ELSE m.text END text,CASE WHEN m.hidden THEN NULL ELSE m.photo_id END photo_id,m.created_at,u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE shipment_id=$1 ORDER BY m.id`,
      ),
      offers: await query(
        "SELECT o.user_id,u.name,u.public_id,u.profile, (SELECT count(*)::int FROM shipments x WHERE x.courier_id=u.id AND x.status='completed') deliveries,(SELECT round(avg(stars),1) FROM reviews r WHERE r.target_id=u.id AND r.role='courier' AND publish_at<=now() AND NOT hidden) rating FROM courier_offers o JOIN users u ON o.user_id=u.id WHERE shipment_id=$1",
      ),
      participants: await query(
        "SELECT id,name,public_id,identity FROM users WHERE id IN(SELECT sender_id FROM shipments WHERE id=$1 UNION SELECT recipient_id FROM shipments WHERE id=$1 UNION SELECT courier_id FROM shipments WHERE id=$1)",
      ),
      disputes: await query(
        "SELECT * FROM disputes WHERE shipment_id=$1 ORDER BY created_at",
      ),
      reviews: await query(
        "SELECT * FROM reviews WHERE shipment_id=$1 AND publish_at<=now() AND NOT hidden",
      ),
      reservations: await query(
        "SELECT r.id,r.stage,r.status,r.expires_at,l.name,l.connected FROM reservations r JOIN compartments c ON c.id=r.compartment_id JOIN lockers l ON l.id=c.locker_id WHERE shipment_id=$1",
      ),
    };
  });
}
export async function listShipments(u: User) {
  return (
    await pool.query(
      `SELECT id,status,sender_id,recipient_id,courier_id,custodian_id,location,CASE WHEN status IN ('completed','returned','cancelled') THEN data-'lastLocation' ELSE data END data,payment_status,dispute_status,created_at FROM shipments WHERE $1 IN(sender_id,recipient_id,courier_id) ORDER BY created_at DESC`,
      [u.id],
    )
  ).rows;
}
export async function nearby(u: User, params: URLSearchParams) {
  const lat = Number(params.get("lat") ?? 40.38),
    lng = Number(params.get("lng") ?? 71.78);
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    throw new AppError(400, "Неверные координаты");
  const city = params.get("city") ?? String(u.profile.city ?? "Фергана");
  const destLat = Number(params.get("destLat") ?? lat),
    destLng = Number(params.get("destLng") ?? lng);
  const trip = (
    await pool.query("SELECT data FROM routes WHERE user_id=$1", [u.id])
  ).rows[0]?.data;
  const planned = trip?.departAt ? Date.parse(trip.departAt) : Date.now();
  const departure = Math.max(
    Date.now(),
    Number.isFinite(planned) ? planned : Date.now(),
  );
  const rows = (
    await pool.query(
      "SELECT id,sender_id,recipient_id,data,created_at FROM shipments WHERE status='published' AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.shipment_id=shipments.id) AND sender_id<>$1 AND (recipient_id IS NULL OR recipient_id<>$1) AND data->'origin'->>'city'=$2",
      [u.id, city],
    )
  ).rows;
  return rows
    .map((s) => {
      const a: [number, number] = [s.data.origin.lat, s.data.origin.lng],
        b: [number, number] = [s.data.destination.lat, s.data.destination.lng];
      const proximity = mapsProvider.estimate([lat, lng], a).km;
      const detour = Math.max(
        0,
        proximity +
          mapsProvider.estimate(a, b).km +
          mapsProvider.estimate(b, [destLat, destLng]).km -
          mapsProvider.estimate([lat, lng], [destLat, destLng]).km,
      );
      return {
        id: s.id,
        origin: {
          city: s.data.origin.city,
          district: s.data.origin.district,
          kind: s.data.origin.kind,
        },
        destination: {
          city: s.data.destination.city,
          district: s.data.destination.district,
          kind: s.data.destination.kind,
        },
        description: s.data.description,
        category: s.data.category,
        weight: s.data.weight,
        dimensions: s.data.dimensions,
        deliverBy: s.data.deliverBy,
        price: s.data.price,
        approximate: true,
        proximity,
        detour,
        additionalMinutes: Math.round(detour * 3),
        score: proximity + detour,
      };
    })
    .filter(
      (s) =>
        new Date(s.deliverBy).getTime() > departure &&
        (u.profile.transport !== "walk" || s.weight <= 5),
    )
    .sort((a, b) => a.score - b.score);
}
export async function adminData(u: User) {
  requireRole(u, ["admin", "support", "finance", "operator"]);
  if (u.role === "operator")
    return {
      lockers: (
        await pool.query("SELECT * FROM lockers WHERE operator_id=$1", [u.id])
      ).rows,
      point_requests: (
        await pool.query(
          "SELECT r.* FROM point_requests r JOIN lockers l ON l.id=r.locker_id WHERE l.operator_id=$1 AND r.status='pending'",
          [u.id],
        )
      ).rows,
      shipments: [],
      metrics: {},
      users: [],
      disputes: [],
      payments: [],
      payouts: [],
      refunds: [],
      audit: [],
      reports: [],
    };
  const finance = ["finance", "admin"].includes(u.role);
  const q = async (sql: string) => (await pool.query(sql)).rows;
  const metrics = (
    await q(
      `SELECT count(*)::int total,count(*) FILTER(WHERE status='published')::int published,count(*) FILTER(WHERE status='completed')::int completed,count(*) FILTER(WHERE courier_id IS NOT NULL)::float/nullif(count(*) FILTER(WHERE status<>'draft'),0) assigned_share,count(*) FILTER(WHERE status='cancelled')::int cancelled,count(*) FILTER(WHERE dispute_status='open')::int disputes,count(DISTINCT courier_id) FILTER(WHERE status IN ('assigned','picked_up','in_transit','awaiting_receipt'))::int active_couriers FROM shipments`,
    )
  )[0];
  metrics.assignment_minutes = (
    await q(
      "SELECT avg(extract(epoch FROM(a.created_at-s.created_at))/60) minutes FROM assignments a JOIN shipments s ON s.id=a.shipment_id",
    )
  )[0].minutes;
  metrics.ontime_share = (
    await q(
      "SELECT avg(((SELECT min(created_at) FROM tracking_events e WHERE e.shipment_id=shipments.id AND e.status='received') <= (data->>'deliverBy')::timestamptz)::int) share FROM shipments WHERE status='completed'",
    )
  )[0].share;
  metrics.repeat_senders = (
    await q(
      "SELECT count(*)::int n FROM (SELECT sender_id FROM shipments WHERE status='completed' GROUP BY sender_id HAVING count(*)>1) x",
    )
  )[0].n;
  metrics.money = (
    await q(
      "SELECT coalesce(sum(amount),0)::int total FROM payments WHERE status='paid'",
    )
  )[0].total;
  metrics.fees = (
    await q(
      "SELECT coalesce(sum((data->'price'->>'fee')::int),0)::int total FROM shipments WHERE payment_status='paid'",
    )
  )[0].total;
  metrics.refunded = (
    await q(
      "SELECT coalesce(sum(amount),0)::int total FROM refunds WHERE status='refunded'",
    )
  )[0].total;
  return {
    metrics,
    point_requests: await q(
      "SELECT * FROM point_requests WHERE status='pending'",
    ),
    settings: (await q("SELECT data FROM settings WHERE id=1"))[0].data,
    users:
      u.role === "admin"
        ? await q(
            "SELECT id,public_id,name,identity,role,restricted FROM users",
          )
        : [],
    shipments: await q(
      "SELECT id,status,sender_id,courier_id,location,dispute_status,payment_status,payout_status FROM shipments ORDER BY created_at DESC",
    ),
    disputes: await q("SELECT * FROM disputes ORDER BY created_at DESC"),
    payments: finance ? await q("SELECT * FROM payments") : [],
    payouts: finance ? await q("SELECT * FROM payouts") : [],
    refunds: finance ? await q("SELECT * FROM refunds") : [],
    lockers: await q("SELECT * FROM lockers"),
    audit:
      u.role === "admin"
        ? await q("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100")
        : [],
    reports: await q("SELECT * FROM reports"),
  };
}
