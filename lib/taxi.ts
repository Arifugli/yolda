export { distanceKm } from "./distance";
import { dispatchOrder, respondOrder, matchingEvent } from "./orders/matching";
import { serviceVehicles } from "./mobility-catalog";
import { z } from "zod";
import type { PoolClient } from "pg";
import { AppError, verified, type User } from "./auth";
export async function taxiPresence(db: PoolClient, u: User, body: unknown) {
  const kind = z
    .enum(["taxi", "cargo", "equipment"])
    .parse((body as any)?.kind ?? "taxi");
  const type = kind === "taxi" ? "ride" : kind === "cargo" ? "freight" : kind;
  const b = z
    .discriminatedUnion("online", [
      z.object({ online: z.literal(false) }),
      z.object({
        online: z.literal(true),
        vehicleId: z.uuid(),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(200),
        consent: z.literal(true),
      }),
    ])
    .parse(body);
  if (!b.online) {
    await db.query(
      "DELETE FROM executor_presence WHERE user_id=$1 AND service_type=$2",
      [u.id, type],
    );
    return { online: false };
  }
  await verified(db, u);
  const v = (
    await db.query(
      "SELECT * FROM service_vehicles WHERE id=$1 AND owner_id=$2 AND active FOR SHARE",
      [b.vehicleId, u.id],
    )
  ).rows[0];
  if (!v || !serviceVehicles[kind].includes(v.kind))
    throw new AppError(
      400,
      "Выберите собственную активную машину подходящего типа",
    );
  await db.query(
    "INSERT INTO executor_presence(user_id,vehicle_id,lat,lng,accuracy,updated_at,service_type) VALUES($1,$2,$3,$4,$5,now(),$6) ON CONFLICT(user_id,service_type) DO UPDATE SET vehicle_id=$2,lat=$3,lng=$4,accuracy=$5,updated_at=now()",
    [u.id, b.vehicleId, b.lat, b.lng, b.accuracy, type],
  );
  return { online: true, expiresIn: 120 };
}
export async function dispatchTaxi(db: PoolClient, u: User, s: any) {
  if (
    (s.kind !== "taxi" &&
      !(s.engine_version === 1 && s.data.matchingMode === "auto")) ||
    u.id !== s.customer_id
  )
    throw new AppError(
      403,
      "Автопоиск доступен заказчику автоматического заказа",
    );
  if (!["published", "driver_pending"].includes(s.status))
    return { id: s.id, status: s.status };
  const at = new Date(s.data.scheduledAt).getTime();
  // MVP dispatch is on-demand; scheduled rides start matching shortly before pickup.
  if (at > Date.now() + 20 * 60000)
    return {
      id: s.id,
      status: s.status,
      searchStartsAt: new Date(at - 20 * 60000).toISOString(),
    };
  if (at < Date.now() - 3600000) {
    await matchingEvent(
      db,
      u,
      s,
      "cancelled",
      "Поиск истёк; создайте новую поездку",
    );
    return { id: s.id, status: s.status };
  }
  return dispatchOrder(db, u, s);
}
export async function taxiResponse(
  db: PoolClient,
  u: User,
  s: any,
  accept: boolean,
) {
  if (
    s.kind !== "taxi" &&
    !(s.engine_version === 1 && s.data.matchingMode === "auto")
  )
    throw new AppError(403, "Неверная услуга");
  return respondOrder(db, u, s, accept);
}
export async function dispatchWaitingTaxis(db: PoolClient) {
  // Driver heartbeats also advance waiting requests when the passenger leaves the screen.
  const waiting = (
    await db.query(`SELECT r.*,to_jsonb(u.*) AS customer FROM service_requests r JOIN users u ON u.id=r.customer_id
    WHERE r.kind='taxi' AND r.status IN ('published','driver_pending') AND NOT u.restricted
    AND (r.data->>'scheduledAt')::timestamptz<=now()+interval '20 minutes'
    ORDER BY r.created_at LIMIT 20 FOR UPDATE OF r SKIP LOCKED`)
  ).rows;
  for (const s of waiting) await dispatchTaxi(db, s.customer, s);
}
