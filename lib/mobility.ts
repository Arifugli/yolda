import { verticals } from "./orders/verticals";
import { changeOrderState, initializeOrder } from "./orders/core";
import { quoteRide } from "./orders/pricing";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { AppError, verified, type User } from "./auth";
import { codeDigest } from "./secure-cache";
import { otpCode } from "./providers";
import { serviceRequestSchema, vehicleSchema } from "./mobility-schema";
import {
  dispatchTaxi,
  dispatchWaitingTaxis,
  taxiPresence,
  taxiResponse,
} from "./taxi";

const staff = (u: User) => ["support", "admin"].includes(u.role);
const member = (u: User, s: any) =>
  u.id === s.customer_id || u.id === s.provider_id;
function allow(
  condition: boolean,
  message = "Нет доступа",
  status = 403,
): asserts condition {
  if (!condition) throw new AppError(status, message);
}
function stage(s: any, ...states: string[]) {
  allow(states.includes(s.status), "Действие недоступно на текущем этапе", 409);
}
function compatible(s: any, v: any) {
  allow(
    v.active && v.kind === s.data.vehicleKind,
    "Машина не подходит для заявки",
    409,
  );
  if (s.kind === "taxi")
    allow(v.data.seats >= s.data.passengers, "Недостаточно мест", 409);
  if (s.kind === "cargo")
    allow(
      v.data.capacityTonnes >= s.data.weightTonnes,
      "Недостаточная грузоподъёмность",
      409,
    );
  if (v.kind === "crane")
    allow(
      v.data.liftTonnes >= s.data.liftTonnes &&
        v.data.reachMeters >= s.data.reachMeters,
      "Параметры крана не подходят",
      409,
    );
}
async function record(db: PoolClient, u: User, s: any, detail: string) {
  await db.query("UPDATE service_requests SET updated_at=now() WHERE id=$1", [
    s.id,
  ]);
  await db.query(
    "INSERT INTO service_events(request_id,actor_id,status,detail) VALUES($1,$2,$3,$4)",
    [s.id, u.id, s.status, detail],
  );
  await db.query(
    "INSERT INTO audit_logs(actor_id,action,entity_id,detail) VALUES($1,'mobility',$2,$3)",
    [u.id, s.id, JSON.stringify({ status: s.status, detail })],
  );
}
async function transition(
  db: PoolClient,
  u: User,
  s: any,
  status: string,
  detail: string,
) {
  await changeOrderState(db, u, s, status, detail);
  await record(db, u, s, detail);
  return { id: s.id, status };
}
export async function mobilityMutate(
  db: PoolClient,
  u: User,
  action: string,
  id: string | undefined,
  body: unknown,
): Promise<any> {
  if (action === "presence") {
    const r = await taxiPresence(db, u, body);
    if (r.online) await dispatchWaitingTaxis(db);
    return r;
  }
  if (action === "quote") return quoteRide(db, body);
  if (action === "vehicle") {
    await verified(db, u);
    const v = vehicleSchema.parse(body);
    if (v.id) {
      const owned = (
        await db.query(
          "SELECT * FROM service_vehicles WHERE id=$1 FOR UPDATE",
          [v.id],
        )
      ).rows[0];
      allow(owned?.owner_id === u.id);
      allow(
        !(
          await db.query(
            "SELECT 1 FROM service_requests WHERE vehicle_id=$1 AND status NOT IN ('completed','cancelled')",
            [v.id],
          )
        ).rowCount,
        "Машина занята активным заказом",
        409,
      );
      await db.query(
        "UPDATE service_vehicles SET kind=$2,data=$3,active=$4 WHERE id=$1",
        [v.id, v.kind, JSON.stringify(v), v.active],
      );
      return { id: v.id };
    }
    return (
      await db.query(
        "INSERT INTO service_vehicles(owner_id,kind,data,active) VALUES($1,$2,$3,$4) RETURNING id",
        [u.id, v.kind, JSON.stringify(v), v.active],
      )
    ).rows[0];
  }
  if (action === "create") {
    allow(u.phone_verified, "Подтвердите телефон");
    const input = serviceRequestSchema.parse(body);
    const useCore =
      input.kind === "taxi" && process.env.ORDER_CORE_ENABLED !== "false";
    if (useCore) verticals.ride!.parameters.parse(input);
    const quote = input.kind === "taxi" ? await quoteRide(db, input) : null;
    if (quote) {
      allow(
        input.budget === quote.price &&
          (input.quotedTariffVersion === undefined ||
            input.quotedTariffVersion === quote.tariffVersion),
        "Тариф изменился: пересчитайте стоимость перед заказом",
        409,
      );
    }
    const at = new Date(input.scheduledAt).getTime();
    allow(
      at >= Date.now() - 60000 && at <= Date.now() + 366 * 86400000,
      "Выберите актуальные дату и время",
      400,
    );
    const s = (
      await db.query(
        "INSERT INTO orders(customer_id,kind,data,engine_version,status,price_snapshot) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          u.id,
          input.kind,
          JSON.stringify(input),
          useCore ? 1 : 0,
          useCore ? "created" : "published",
          quote ? JSON.stringify(quote) : null,
        ],
      )
    ).rows[0];
    if (useCore) await initializeOrder(db, u, s);
    await record(db, u, s, "Заявка опубликована");
    if (s.kind === "taxi") await dispatchTaxi(db, u, s);
    return { id: s.id };
  }
  const s = (
    await db.query("SELECT * FROM service_requests WHERE id=$1 FOR UPDATE", [
      z.uuid().parse(id),
    ])
  ).rows[0];
  allow(!!s, "Заявка не найдена", 404);
  const customer = u.id === s.customer_id,
    provider = u.id === s.provider_id;
  if (action === "dispatch") return dispatchTaxi(db, u, s);
  if (action === "accept") return taxiResponse(db, u, s, true);
  if (action === "decline" && s.status === "driver_pending")
    return taxiResponse(db, u, s, false);
  if (action === "offer") {
    allow(s.kind !== "taxi", "Такси назначается автоматически", 409);
    stage(s, "published");
    allow(!customer, "Нельзя выполнять собственную заявку");
    await verified(db, u);
    allow(
      new Date(s.data.scheduledAt).getTime() >= Date.now() - 3600000,
      "Заявка устарела",
      409,
    );
    const b = z
      .object({
        vehicleId: z.uuid(),
        price: z.number().int().min(1000).max(1000000000),
        comment: z.string().trim().max(500).default(""),
      })
      .parse(body);
    const v = (
      await db.query("SELECT * FROM service_vehicles WHERE id=$1 FOR SHARE", [
        b.vehicleId,
      ])
    ).rows[0];
    allow(v?.owner_id === u.id, "Выберите собственную машину");
    compatible(s, v);
    await db.query(
      "INSERT INTO service_offers(request_id,provider_id,vehicle_id,price,comment) VALUES($1,$2,$3,$4,$5) ON CONFLICT(request_id,provider_id) DO UPDATE SET vehicle_id=$3,price=$4,comment=$5",
      [s.id, u.id, v.id, b.price, b.comment],
    );
    await record(db, u, s, "Получено предложение исполнителя");
    return { ok: true };
  }
  if (action === "withdraw") {
    stage(s, "published");
    await db.query(
      "DELETE FROM service_offers WHERE request_id=$1 AND provider_id=$2",
      [s.id, u.id],
    );
    return { ok: true };
  }
  if (action === "assign") {
    allow(s.kind !== "taxi", "Такси назначается автоматически", 409);
    allow(customer, "Только заказчик выбирает исполнителя");
    stage(s, "published");
    const b = z.object({ providerId: z.uuid() }).parse(body);
    const o = (
      await db.query(
        "SELECT o.*,v.kind,v.data,v.active,v.owner_id FROM service_offers o JOIN service_vehicles v ON v.id=o.vehicle_id WHERE request_id=$1 AND provider_id=$2 FOR SHARE OF v",
        [s.id, b.providerId],
      )
    ).rows[0];
    allow(!!o, "Предложение не найдено", 404);
    const performer = (
      await db.query("SELECT * FROM users WHERE id=$1", [b.providerId])
    ).rows[0];
    await verified(db, performer);
    compatible(s, o);
    // Serialize assignment across requests sharing one driver or machine.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "mobility-provider:" + b.providerId,
    ]);
    allow(
      !(
        await db.query(
          "SELECT 1 FROM service_requests WHERE provider_id=$1 AND status NOT IN ('completed','cancelled')",
          [b.providerId],
        )
      ).rowCount,
      "Исполнитель уже занят",
      409,
    );
    await db.query(
      "UPDATE service_requests SET provider_id=$2,vehicle_id=$3,agreed_price=$4 WHERE id=$1",
      [s.id, b.providerId, o.vehicle_id, o.price],
    );
    return transition(
      db,
      u,
      s,
      "assigned",
      "Заказчик выбрал исполнителя и согласовал цену",
    );
  }
  allow(
    member(u, s) || (staff(u) && ["resolve", "message"].includes(action)),
    "Вы не участник заявки",
  );
  if (action === "depart") {
    allow(provider);
    stage(s, "assigned");
    await verified(db, u);
    return transition(
      db,
      u,
      s,
      "en_route_to_pickup",
      "Исполнитель выехал к заказчику",
    );
  }
  if (action === "arrive") {
    allow(provider);
    stage(
      s,
      ...(s.engine_version === 1
        ? ["en_route_to_pickup"]
        : ["assigned", "en_route_to_pickup"]),
    );
    await verified(db, u);
    return transition(db, u, s, "arrived", "Исполнитель прибыл");
  }
  if (action === "code") {
    allow(customer);
    stage(s, "arrived");
    const old = (
      await db.query("SELECT * FROM service_start_codes WHERE request_id=$1", [
        s.id,
      ])
    ).rows[0];
    allow(
      !old || new Date(old.expires_at).getTime() < Date.now(),
      "Код уже выдан: дождитесь истечения пяти минут",
      409,
    );
    const code = otpCode();
    await db.query(
      "INSERT INTO service_start_codes(request_id,hash,expires_at) VALUES($1,$2,now()+interval '5 minutes') ON CONFLICT(request_id) DO UPDATE SET hash=$2,expires_at=excluded.expires_at,attempts=0,used_at=NULL",
      [s.id, await codeDigest(code, "service-start:" + s.id)],
    );
    return { code, expiresIn: 300 };
  }
  if (action === "start") {
    allow(provider);
    stage(s, "arrived");
    await verified(db, u);
    const { code } = z
      .object({ code: z.string().regex(/^\d{6}$/) })
      .parse(body);
    const c = (
      await db.query(
        "SELECT * FROM service_start_codes WHERE request_id=$1 FOR UPDATE",
        [s.id],
      )
    ).rows[0];
    allow(
      c &&
        !c.used_at &&
        c.attempts < 5 &&
        new Date(c.expires_at).getTime() > Date.now(),
      "Код истёк или заблокирован",
      409,
    );
    if (c.hash !== (await codeDigest(code, "service-start:" + s.id))) {
      await db.query(
        "UPDATE service_start_codes SET attempts=attempts+1 WHERE request_id=$1",
        [s.id],
      );
      // Commit failed attempts; throwing would roll them back.
      return { rejected: true, message: "Неверный код" };
    }
    await db.query(
      "UPDATE service_start_codes SET used_at=now() WHERE request_id=$1",
      [s.id],
    );
    return transition(
      db,
      u,
      s,
      "in_progress",
      "Заказчик подтвердил начало одноразовым кодом",
    );
  }
  if (action === "finish") {
    allow(provider);
    stage(s, "in_progress");
    return transition(
      db,
      u,
      s,
      "awaiting_confirmation",
      "Исполнитель сообщил о выполнении",
    );
  }
  if (action === "complete") {
    allow(customer);
    stage(s, "awaiting_confirmation");
    allow(s.dispute_status !== "open", "Сначала разрешите спор", 409);
    return transition(db, u, s, "completed", "Заказчик подтвердил выполнение");
  }
  if (action === "cancel") {
    allow(customer);
    stage(
      s,
      "published",
      "driver_pending",
      "assigned",
      "en_route_to_pickup",
      "arrived",
    );
    return transition(
      db,
      u,
      s,
      "cancelled",
      "Заказчик отменил заявку до начала",
    );
  }
  if (action === "decline") {
    allow(provider);
    stage(s, "assigned", "en_route_to_pickup", "arrived");
    await db.query(
      "UPDATE service_requests SET provider_id=NULL,vehicle_id=NULL,agreed_price=NULL WHERE id=$1",
      [s.id],
    );
    await db.query("DELETE FROM service_start_codes WHERE request_id=$1", [
      s.id,
    ]);
    await db.query(
      "DELETE FROM service_offers WHERE request_id=$1 AND provider_id=$2",
      [s.id, u.id],
    );
    return transition(
      db,
      u,
      s,
      "published",
      "Исполнитель отказался до начала; поиск возобновлён",
    );
  }
  if (action === "message") {
    allow(!!s.provider_id, "Чат откроется после назначения", 409);
    const { text } = z
      .object({ text: z.string().trim().min(1).max(2000) })
      .parse(body);
    await db.query(
      "INSERT INTO service_messages(request_id,author_id,text) VALUES($1,$2,$3)",
      [s.id, u.id, text],
    );
    if (staff(u) && !member(u, s))
      await record(db, u, s, "Сообщение поддержки");
    return { ok: true };
  }
  if (action === "dispute") {
    stage(
      s,
      "assigned",
      "en_route_to_pickup",
      "arrived",
      "in_progress",
      "awaiting_confirmation",
      "completed",
    );
    allow(s.dispute_status !== "open", "Спор уже открыт", 409);
    const { reason } = z
      .object({ reason: z.string().trim().min(5).max(1000) })
      .parse(body);
    await db.query(
      "UPDATE service_requests SET dispute_status='open',dispute_reason=$2,dispute_resolution=NULL WHERE id=$1",
      [s.id, reason],
    );
    await record(db, u, s, "Открыт спор");
    return { ok: true };
  }
  if (action === "resolve") {
    allow(staff(u));
    allow(s.dispute_status === "open", "Нет открытого спора", 409);
    const { resolution } = z
      .object({ resolution: z.string().trim().min(5).max(1000) })
      .parse(body);
    await db.query(
      "UPDATE service_requests SET dispute_status='resolved',dispute_resolution=$2 WHERE id=$1",
      [s.id, resolution],
    );
    await record(db, u, s, "Поддержка разрешила спор");
    return { ok: true };
  }
  if (action === "review") {
    stage(s, "completed");
    allow(member(u, s));
    const b = z
      .object({
        stars: z.number().int().min(1).max(5),
        comment: z.string().trim().max(1000),
      })
      .parse(body);
    await db.query(
      "INSERT INTO service_reviews(request_id,author_id,target_id,stars,comment) VALUES($1,$2,$3,$4,$5)",
      [
        s.id,
        u.id,
        customer ? s.provider_id : s.customer_id,
        b.stars,
        b.comment,
      ],
    );
    if (
      (
        await db.query(
          "SELECT 1 FROM service_reviews WHERE request_id=$1 AND author_id<>$2",
          [s.id, u.id],
        )
      ).rowCount
    )
      await db.query(
        "UPDATE service_reviews SET publish_at=now() WHERE request_id=$1",
        [s.id],
      );
    return { ok: true };
  }
  throw new AppError(404, "Действие не найдено");
}

function publicRequest(s: any) {
  return {
    id: s.id,
    kind: s.kind,
    status: s.status,
    created_at: s.created_at,
    data: {
      vehicleKind: s.data.vehicleKind,
      publicSummary: s.data.publicSummary,
      origin: { city: s.data.origin.city },
      destination: s.data.destination
        ? { city: s.data.destination.city }
        : undefined,
      scheduledAt: s.data.scheduledAt,
      passengers: s.data.passengers,
      weightTonnes: s.data.weightTonnes,
      liftTonnes: s.data.liftTonnes,
      reachMeters: s.data.reachMeters,
      durationHours: s.data.durationHours,
      budget: s.data.budget,
    },
  };
}
export async function mobilityList(u: User, params: URLSearchParams) {
  const view = z
    .enum(["market", "mine", "support"])
    .parse(params.get("view") ?? "market");
  const kind = z
    .enum(["taxi", "cargo", "equipment"])
    .parse(params.get("kind") ?? "taxi");
  if (view === "support") allow(staff(u));
  const rows = (
    await pool.query(
      `SELECT s.*, (SELECT count(*)::int FROM service_offers o WHERE o.request_id=s.id) offer_count FROM service_requests s WHERE kind=$1 AND ${view === "market" ? "status='published' AND customer_id<>$2 AND (data->>'scheduledAt')::timestamptz>now()-interval '1 hour'" : view === "support" ? "dispute_status='open' AND $2::uuid IS NOT NULL" : "(customer_id=$2 OR provider_id=$2 OR EXISTS(SELECT 1 FROM service_offers o WHERE o.request_id=s.id AND o.provider_id=$2))"} ORDER BY created_at DESC LIMIT 100`,
      [kind, u.id],
    )
  ).rows;
  return rows.map((s) =>
    member(u, s) || view === "support" ? s : publicRequest(s),
  );
}
export async function mobilityVehicles(u: User) {
  return (
    await pool.query(
      "SELECT * FROM service_vehicles WHERE owner_id=$1 ORDER BY created_at DESC",
      [u.id],
    )
  ).rows;
}
export async function mobilityPresence(u: User) {
  const p = (
    await pool.query(
      "SELECT * FROM taxi_presence WHERE user_id=$1 AND updated_at>now()-interval '120 seconds'",
      [u.id],
    )
  ).rows[0];
  const incoming = (
    await pool.query(
      "SELECT r.*,d.expires_at FROM service_requests r JOIN taxi_dispatches d ON d.request_id=r.id AND d.provider_id=$1 AND d.status='pending' AND d.expires_at>now() WHERE r.provider_id=$1 AND r.status='driver_pending'",
      [u.id],
    )
  ).rows;
  return { online: !!p, vehicleId: p?.vehicle_id ?? null, incoming };
}
export async function mobilityDetail(u: User, id: string) {
  const s = (
    await pool.query("SELECT * FROM service_requests WHERE id=$1", [
      z.uuid().parse(id),
    ])
  ).rows[0];
  allow(!!s, "Заявка не найдена", 404);
  if (!member(u, s) && !staff(u)) {
    stage(s, "published");
    return {
      ...publicRequest(s),
      myOffer:
        (
          await pool.query(
            "SELECT * FROM service_offers WHERE request_id=$1 AND provider_id=$2",
            [s.id, u.id],
          )
        ).rows[0] ?? null,
    };
  }
  if (!member(u, s))
    await pool.query(
      "INSERT INTO audit_logs(actor_id,action,entity_id) VALUES($1,'mobility.support.read',$2)",
      [u.id, s.id],
    );
  const offers = (
    await pool.query(
      "SELECT o.*,u.name,v.kind,v.data vehicle FROM service_offers o JOIN users u ON u.id=o.provider_id JOIN service_vehicles v ON v.id=o.vehicle_id WHERE request_id=$1 AND ($2::boolean OR o.provider_id=$3) ORDER BY o.created_at",
      [s.id, u.id === s.customer_id || staff(u), u.id],
    )
  ).rows;
  const messages = (
    await pool.query(
      "SELECT m.*,u.name FROM service_messages m JOIN users u ON u.id=m.author_id WHERE request_id=$1 ORDER BY m.id DESC LIMIT 100",
      [s.id],
    )
  ).rows.reverse();
  const events = (
    await pool.query(
      "SELECT * FROM service_events WHERE request_id=$1 ORDER BY id DESC LIMIT 100",
      [s.id],
    )
  ).rows.reverse();
  const reviews = (
    await pool.query(
      "SELECT * FROM service_reviews WHERE request_id=$1 AND (publish_at<=now() OR author_id=$2)",
      [s.id, u.id],
    )
  ).rows;
  const participants = (
    await pool.query(
      "SELECT id,name,public_id FROM users WHERE id=ANY($1::uuid[])",
      [[s.customer_id, s.provider_id].filter(Boolean)],
    )
  ).rows;
  return { ...s, offers, messages, events, reviews, participants };
}
