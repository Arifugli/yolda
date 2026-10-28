import { z } from "zod";
import type { PoolClient } from "pg";
import { AppError, verified, type User } from "../auth";
import { initializeOrder, changeOrderState } from "./core";
import { dispatchOrder } from "./matching";
export async function deliveryOrder(db: PoolClient, id: string) {
  return (
    await db.query(
      "SELECT * FROM orders WHERE id=$1 AND kind='delivery' FOR UPDATE",
      [id],
    )
  ).rows[0];
}
export async function createDeliveryOrder(
  db: PoolClient,
  u: User,
  s: any,
  quote: any,
) {
  const data = { ...s.data, budget: quote.price };
  const settings = (
    await db.query("SELECT data FROM settings WHERE id=1 FOR SHARE")
  ).rows[0].data;
  const order = (
    await db.query(
      "INSERT INTO orders(id,shipment_id,customer_id,kind,data,status,engine_version,price_snapshot) VALUES($1,$1,$2,'delivery',$3,'created',1,$4) RETURNING *",
      [
        s.id,
        u.id,
        JSON.stringify(data),
        JSON.stringify({
          ...quote,
          currency: "UZS",
          rules: {
            base: settings.base,
            perKm: settings.perKm,
            perKg: settings.perKg,
            commission: settings.commission,
          },
          breakdown: s.data.price,
        }),
      ],
    )
  ).rows[0];
  await initializeOrder(db, u, order);
  await dispatchOrder(db, u, order);
}
export async function syncDeliveryState(
  db: PoolClient,
  u: User,
  s: any,
  next: string,
  detail: string,
) {
  const order = await deliveryOrder(db, s.id);
  if (!order) return;
  const states: Record<string, string> = {
    published: "published",
    assigned: "assigned",
    pickup_arrived: "arrived",
    picked_up: "in_progress",
    completed: "completed",
    cancelled: "cancelled",
    returned: "completed",
  };
  const state = states[next];
  if (!state) return; // Custody/return substeps stay in the delivery vertical.
  if (state === "published") {
    await db.query(
      "UPDATE order_dispatches SET status='rejected' WHERE request_id=$1 AND status IN ('pending','accepted')",
      [s.id],
    );
    await db.query(
      "UPDATE orders SET provider_id=NULL,vehicle_id=NULL,agreed_price=NULL WHERE id=$1",
      [s.id],
    );
  }
  if (order.status !== state)
    await changeOrderState(db, u, order, state, detail);
  if (["completed", "cancelled"].includes(state))
    await db.query(
      "UPDATE order_dispatches SET status='rejected' WHERE request_id=$1 AND status='pending'",
      [s.id],
    );
}
export async function courierPresence(db: PoolClient, u: User, body: unknown) {
  const b = z
    .discriminatedUnion("online", [
      z.object({ online: z.literal(false) }),
      z.object({
        online: z.literal(true),
        transport: z.enum(["walk", "bike", "scooter", "car"]),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(200),
        consent: z.literal(true),
      }),
    ])
    .parse(body);
  if (!b.online) {
    await db.query(
      "DELETE FROM executor_presence WHERE user_id=$1 AND service_type='delivery'",
      [u.id],
    );
    return { online: false };
  }
  await verified(db, u);
  if (!u.profile.accepting)
    throw new AppError(409, "Включите приём заказов в профиле");
  // Transport is persisted in the existing courier profile; cannot claim a different type in heartbeat.
  const transport = ["walk", "bike", "scooter", "car"].includes(
    String(u.profile.transport),
  )
    ? u.profile.transport
    : null;
  if (b.transport !== transport)
    throw new AppError(409, "Транспорт не совпадает с профилем");
  await db.query(
    `INSERT INTO executor_presence(user_id,service_type,vehicle_id,transport,lat,lng,accuracy) VALUES($1,'delivery',NULL,$2,$3,$4,$5)
 ON CONFLICT(user_id,service_type) DO UPDATE SET transport=$2,lat=$3,lng=$4,accuracy=$5,updated_at=now()`,
    [u.id, b.transport, b.lat, b.lng, b.accuracy],
  );
  return { online: true, expiresIn: 120 };
}
export async function courierInbox(db: PoolClient, u: User) {
  const incoming = (
    await db.query(
      `SELECT o.id,o.agreed_price,d.expires_at,o.data->'origin' AS origin,o.data->'destination' AS destination,o.data->>'weight' AS weight
 FROM orders o JOIN order_dispatches d ON d.request_id=o.id AND d.provider_id=$1 AND d.status='pending' AND d.expires_at>now()
 WHERE o.kind='delivery' AND o.status='driver_pending' AND o.provider_id=$1`,
      [u.id],
    )
  ).rows;
  return { incoming };
}
export async function executorPosition(
  db: { query: PoolClient["query"] },
  id: string,
  type: string,
  active: boolean,
) {
  if (!active) return null;
  return (
    (
      await db.query(
        "SELECT lat,lng,accuracy,updated_at FROM executor_presence WHERE user_id=$1 AND service_type=$2 AND updated_at>now()-interval '120 seconds'",
        [id, type],
      )
    ).rows[0] ?? null
  );
}
