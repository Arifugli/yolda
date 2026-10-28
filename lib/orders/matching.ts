import type { PoolClient } from "pg";
import { AppError, verified, type User } from "../auth";
import { distanceKm } from "../distance";
import { changeOrderState } from "./core";
export function searchRadius(createdAt: string | Date, attempts: number) {
  const age = Math.max(0, Date.now() - new Date(createdAt).getTime());
  return Math.max(age, attempts * 45000) >= 90000
    ? 8
    : Math.max(age, attempts * 45000) >= 45000
      ? 5
      : 2;
}
export function rankCandidates(
  origin: { lat: number; lng: number },
  rows: any[],
  radius: number,
) {
  return rows
    .map((p) => ({ ...p, distance: distanceKm(origin, p) }))
    .filter((p) => Number.isFinite(p.distance) && p.distance <= radius)
    .sort(
      (a, b) => a.distance - b.distance || a.user_id.localeCompare(b.user_id),
    );
}
export async function executorBusy(
  db: PoolClient,
  id: string,
  except?: string,
) {
  return !!(
    await db.query(
      `SELECT 1 FROM orders WHERE provider_id=$1 AND status NOT IN ('completed','cancelled') AND id<>coalesce($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
 UNION ALL SELECT 1 FROM shipments WHERE courier_id=$1 AND status NOT IN ('completed','cancelled','returned') AND id<>coalesce($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid) LIMIT 1`,
      [id, except ?? null],
    )
  ).rowCount;
}
export async function lockExecutor(
  db: PoolClient,
  id: string,
  except?: string,
  includeLegacy = true,
) {
  const locked = (
    await db.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",
      ["mobility-provider:" + id],
    )
  ).rows[0].locked;
  return (
    locked &&
    !(includeLegacy
      ? await executorBusy(db, id, except)
      : !!(
          await db.query(
            "SELECT 1 FROM orders WHERE provider_id=$1 AND status NOT IN ('completed','cancelled') AND id<>coalesce($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)",
            [id, except ?? null],
          )
        ).rowCount)
  );
}
export async function matchingEvent(
  db: PoolClient,
  u: User,
  s: any,
  status: string,
  detail: string,
) {
  await changeOrderState(db, u, s, status, detail);
  await db.query(
    "INSERT INTO service_events(request_id,actor_id,status,detail) VALUES($1,$2,$3,$4)",
    [s.id, u.id, status, detail],
  );
  await db.query(
    "INSERT INTO audit_logs(actor_id,action,entity_id,detail) VALUES($1,'order.dispatch',$2,$3)",
    [u.id, s.id, JSON.stringify({ status, detail })],
  );
}
export async function eligible(db: PoolClient, s: any, id: string) {
  const type =
    s.kind === "taxi" ? "ride" : s.kind === "cargo" ? "freight" : s.kind;
  const p = (
    await db.query(
      `SELECT p.*,u.phone,u.profile,u.identity,u.restricted FROM executor_presence p JOIN users u ON u.id=p.user_id
 WHERE p.user_id=$1 AND p.service_type=$2 AND p.updated_at>now()-interval '120 seconds' FOR SHARE OF p SKIP LOCKED`,
      [id, type],
    )
  ).rows[0];
  if (!p || p.restricted || p.identity !== "verified" || id === s.customer_id)
    return null;
  try {
    await verified(db, { id } as User);
  } catch (e) {
    if (e instanceof AppError) return null;
    throw e;
  }
  if (type !== "delivery") {
    const v = (
      await db.query(
        "SELECT * FROM service_vehicles WHERE id=$1 AND owner_id=$2 AND active FOR SHARE",
        [p.vehicle_id, id],
      )
    ).rows[0];
    if (
      !v ||
      v.kind !== s.data.vehicleKind ||
      (type === "ride" && v.data.seats < s.data.passengers) ||
      (type === "freight" && v.data.capacityTonnes < s.data.weightTonnes) ||
      (v.kind === "crane" &&
        (v.data.liftTonnes < s.data.liftTonnes ||
          v.data.reachMeters < s.data.reachMeters))
    )
      return null;
  } else {
    const shipment = (
      await db.query("SELECT recipient_id,data FROM shipments WHERE id=$1", [
        s.shipment_id,
      ])
    ).rows[0];
    if (
      !shipment ||
      shipment.recipient_id === id ||
      shipment.data.recipient === p.phone ||
      !p.profile.accepting ||
      p.profile.transport !== p.transport ||
      (p.transport === "walk" && shipment.data.weight > 5) ||
      shipment.data.weight > 10
    )
      return null;
  }
  return p;
}
export async function dispatchOrder(db: PoolClient, u: User, s: any) {
  if (!["published", "driver_pending"].includes(s.status))
    return { id: s.id, status: s.status };
  if (s.status === "driver_pending") {
    const pending = (
      await db.query(
        "SELECT * FROM order_dispatches WHERE request_id=$1 AND status='pending' FOR UPDATE",
        [s.id],
      )
    ).rows[0];
    if (pending && new Date(pending.expires_at).getTime() > Date.now())
      return { id: s.id, status: s.status };
    await db.query(
      "UPDATE order_dispatches SET status='expired' WHERE request_id=$1 AND status='pending'",
      [s.id],
    );
    await db.query(
      "UPDATE orders SET provider_id=NULL,vehicle_id=NULL,agreed_price=NULL WHERE id=$1",
      [s.id],
    );
    await matchingEvent(
      db,
      u,
      s,
      "published",
      "Исполнитель не ответил; поиск продолжен",
    );
  }
  const attempts = Number(
    (
      await db.query(
        "SELECT count(*) FROM order_dispatches WHERE request_id=$1",
        [s.id],
      )
    ).rows[0].count,
  );
  const radius = searchRadius(s.created_at, attempts),
    type = s.kind === "taxi" ? "ride" : s.kind === "cargo" ? "freight" : s.kind;
  const rows = (
    await db.query(
      `SELECT p.* FROM executor_presence p WHERE service_type=$1 AND updated_at>now()-interval '120 seconds'
 AND NOT EXISTS(SELECT 1 FROM order_dispatches d WHERE d.request_id=$2 AND d.provider_id=p.user_id)`,
      [type, s.id],
    )
  ).rows;
  for (const c of rankCandidates(s.data.origin, rows, radius)) {
    if (!(await lockExecutor(db, c.user_id))) continue;
    const p = await eligible(db, s, c.user_id);
    if (!p || distanceKm(s.data.origin, p) > radius) continue;
    await db.query(
      "INSERT INTO order_dispatches(request_id,provider_id,vehicle_id,status,expires_at) VALUES($1,$2,$3,'pending',now()+interval '45 seconds')",
      [s.id, p.user_id, p.vehicle_id],
    );
    await db.query(
      "UPDATE orders SET provider_id=$2,vehicle_id=$3,agreed_price=$4 WHERE id=$1",
      [s.id, p.user_id, p.vehicle_id, s.price_snapshot?.price ?? s.data.budget],
    );
    await matchingEvent(
      db,
      u,
      s,
      "driver_pending",
      "Ближайшему подходящему исполнителю предложен заказ",
    );
    return { id: s.id, status: s.status, radiusKm: radius };
  }
  return { id: s.id, status: s.status, noDriver: true, radiusKm: radius };
}
export async function respondOrder(
  db: PoolClient,
  u: User,
  s: any,
  accept: boolean,
) {
  if (s.provider_id !== u.id || s.status !== "driver_pending")
    throw new AppError(409, "Предложение больше недоступно");
  const d = (
    await db.query(
      "SELECT * FROM order_dispatches WHERE request_id=$1 AND provider_id=$2 AND status='pending' FOR UPDATE",
      [s.id, u.id],
    )
  ).rows[0];
  if (!d || new Date(d.expires_at).getTime() <= Date.now())
    throw new AppError(409, "Время ответа истекло");
  if (accept) {
    const candidate = await eligible(db, s, u.id);
    if (
      !(await lockExecutor(db, u.id, s.id)) ||
      !candidate ||
      candidate.vehicle_id !== s.vehicle_id
    )
      throw new AppError(409, "Исполнитель недоступен или уже занят");
    await db.query(
      "UPDATE order_dispatches SET status='accepted' WHERE request_id=$1 AND provider_id=$2",
      [s.id, u.id],
    );
    await matchingEvent(db, u, s, "assigned", "Исполнитель принял заказ");
  } else {
    await db.query(
      "UPDATE order_dispatches SET status='rejected' WHERE request_id=$1 AND provider_id=$2",
      [s.id, u.id],
    );
    await db.query(
      "UPDATE orders SET provider_id=NULL,vehicle_id=NULL,agreed_price=NULL WHERE id=$1",
      [s.id],
    );
    await matchingEvent(
      db,
      u,
      s,
      "published",
      "Исполнитель отказался; поиск продолжен",
    );
  }
  return { id: s.id, status: s.status };
}
