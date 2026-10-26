import { z } from "zod";
import type { PoolClient } from "pg";
import { AppError, verified, type User } from "./auth";
const coordinate = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const r = Math.PI / 180,
    dlat = (b.lat - a.lat) * r,
    dlng = (b.lng - a.lng) * r;
  return (
    6371 *
    2 *
    Math.asin(
      Math.sqrt(
        Math.min(
          1,
          Math.sin(dlat / 2) ** 2 +
            Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlng / 2) ** 2,
        ),
      ),
    )
  );
}
export function taxiQuote(data: unknown) {
  const b = z
      .object({ origin: coordinate, destination: coordinate })
      .parse(data),
    km = distanceKm(b.origin, b.destination);
  if (km < 0.05 || km > 150)
    throw new AppError(
      400,
      "Поездка должна быть от 50 метров до 150 км по прямой",
    );
  // A transparent fixed demo quote; it does not claim a road distance or routing ETA.
  return {
    price: Math.max(10000, Math.ceil((7000 + km * 2500) / 1000) * 1000),
    distanceKm: Math.round(km * 100) / 100,
    approximate: true,
  };
}
async function event(
  db: PoolClient,
  u: User,
  s: any,
  status: string,
  detail: string,
) {
  await db.query(
    "UPDATE service_requests SET status=$2,updated_at=now() WHERE id=$1",
    [s.id, status],
  );
  s.status = status;
  await db.query(
    "INSERT INTO service_events(request_id,actor_id,status,detail) VALUES($1,$2,$3,$4)",
    [s.id, u.id, status, detail],
  );
  await db.query(
    "INSERT INTO audit_logs(actor_id,action,entity_id,detail) VALUES($1,'taxi.dispatch',$2,$3)",
    [u.id, s.id, JSON.stringify({ status, detail })],
  );
}
export async function taxiPresence(db: PoolClient, u: User, body: unknown) {
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
    await db.query("DELETE FROM taxi_presence WHERE user_id=$1", [u.id]);
    return { online: false };
  }
  await verified(db, u);
  const v = (
    await db.query(
      "SELECT * FROM service_vehicles WHERE id=$1 AND owner_id=$2 AND active FOR SHARE",
      [b.vehicleId, u.id],
    )
  ).rows[0];
  if (!v || !["sedan", "minivan"].includes(v.kind))
    throw new AppError(
      400,
      "Для такси нужна собственная активная легковая машина или минивэн",
    );
  await db.query(
    "INSERT INTO taxi_presence(user_id,vehicle_id,lat,lng,accuracy,updated_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(user_id) DO UPDATE SET vehicle_id=$2,lat=$3,lng=$4,accuracy=$5,updated_at=now()",
    [u.id, b.vehicleId, b.lat, b.lng, b.accuracy],
  );
  return { online: true, expiresIn: 120 };
}
export async function dispatchTaxi(db: PoolClient, u: User, s: any) {
  if (s.kind !== "taxi" || u.id !== s.customer_id)
    throw new AppError(403, "Автопоиск доступен заказчику такси");
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
    await event(db, u, s, "cancelled", "Поиск истёк; создайте новую поездку");
    return { id: s.id, status: s.status };
  }
  if (s.status === "driver_pending") {
    const pending = (
      await db.query(
        "SELECT * FROM taxi_dispatches WHERE request_id=$1 AND status='pending' FOR UPDATE",
        [s.id],
      )
    ).rows[0];
    if (pending && new Date(pending.expires_at).getTime() > Date.now())
      return { id: s.id, status: s.status };
    await db.query(
      "UPDATE taxi_dispatches SET status='expired' WHERE request_id=$1 AND status='pending'",
      [s.id],
    );
    await db.query(
      "UPDATE service_requests SET provider_id=NULL,vehicle_id=NULL,agreed_price=NULL WHERE id=$1",
      [s.id],
    );
    await event(db, u, s, "published", "Водитель не ответил; поиск продолжен");
  }
  const origin = coordinate.parse(s.data.origin);
  const nearby = (
    await db.query(
      `SELECT p.user_id,p.lat,p.lng FROM taxi_presence p JOIN service_vehicles v ON v.id=p.vehicle_id JOIN users u ON u.id=p.user_id
    WHERE p.updated_at>now()-interval '120 seconds' AND p.user_id<>$1 AND v.active AND v.kind=$2
    AND (v.data->>'seats')::int >= $3 AND u.identity='verified' AND NOT u.restricted
    AND NOT EXISTS(SELECT 1 FROM taxi_dispatches d WHERE d.request_id=$4 AND d.provider_id=p.user_id)
    AND NOT EXISTS(SELECT 1 FROM service_requests r WHERE r.provider_id=p.user_id AND r.status NOT IN ('completed','cancelled'))`,
      [u.id, s.data.vehicleKind, s.data.passengers, s.id],
    )
  ).rows
    .map((p) => ({
      ...p,
      distance: distanceKm(origin, { lat: p.lat, lng: p.lng }),
    }))
    .filter((p) => p.distance <= 8)
    .sort((a, b) => a.distance - b.distance);
  for (const candidate of nearby) {
    const p = (
      await db.query(
        "SELECT * FROM taxi_presence WHERE user_id=$1 AND updated_at>now()-interval '120 seconds' FOR UPDATE SKIP LOCKED",
        [candidate.user_id],
      )
    ).rows[0];
    if (!p) continue;
    if (
      !(
        await db.query(
          "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",
          ["mobility-provider:" + p.user_id],
        )
      ).rows[0].locked
    )
      continue;
    if (
      (
        await db.query(
          "SELECT 1 FROM service_requests WHERE provider_id=$1 AND status NOT IN ('completed','cancelled')",
          [p.user_id],
        )
      ).rowCount
    )
      continue;
    const v = (
      await db.query(
        "SELECT * FROM service_vehicles WHERE id=$1 AND owner_id=$2 AND active FOR SHARE",
        [p.vehicle_id, p.user_id],
      )
    ).rows[0];
    if (!v || v.kind !== s.data.vehicleKind || v.data.seats < s.data.passengers)
      continue;
    const driver = (
      await db.query("SELECT * FROM users WHERE id=$1", [p.user_id])
    ).rows[0];
    try {
      await verified(db, driver);
    } catch (e) {
      if (e instanceof AppError) continue;
      throw e;
    }
    if (distanceKm(origin, { lat: p.lat, lng: p.lng }) > 8) continue;
    await db.query(
      "INSERT INTO taxi_dispatches(request_id,provider_id,vehicle_id,status,expires_at) VALUES($1,$2,$3,'pending',now()+interval '45 seconds')",
      [s.id, p.user_id, v.id],
    );
    await db.query(
      "UPDATE service_requests SET provider_id=$2,vehicle_id=$3,agreed_price=$4 WHERE id=$1",
      [s.id, p.user_id, v.id, s.data.budget],
    );
    await event(
      db,
      u,
      s,
      "driver_pending",
      "Ближайшему доступному водителю предложена поездка",
    );
    return { id: s.id, status: s.status };
  }
  return { id: s.id, status: s.status, noDriver: true };
}
export async function taxiResponse(
  db: PoolClient,
  u: User,
  s: any,
  accept: boolean,
) {
  if (
    s.kind !== "taxi" ||
    s.provider_id !== u.id ||
    s.status !== "driver_pending"
  )
    throw new AppError(409, "Предложение больше недоступно");
  const pending = (
    await db.query(
      "SELECT * FROM taxi_dispatches WHERE request_id=$1 AND provider_id=$2 AND status='pending' FOR UPDATE",
      [s.id, u.id],
    )
  ).rows[0];
  if (!pending || new Date(pending.expires_at).getTime() <= Date.now())
    throw new AppError(409, "Время ответа истекло");
  if (accept) {
    await verified(db, u);
    const v = (
      await db.query(
        "SELECT * FROM service_vehicles WHERE id=$1 AND active FOR SHARE",
        [s.vehicle_id],
      )
    ).rows[0];
    if (!v || v.kind !== s.data.vehicleKind || v.data.seats < s.data.passengers)
      throw new AppError(409, "Машина больше не подходит");
    await db.query(
      "UPDATE taxi_dispatches SET status='accepted' WHERE request_id=$1 AND provider_id=$2",
      [s.id, u.id],
    );
    await event(db, u, s, "assigned", "Водитель принял поездку");
  } else {
    await db.query(
      "UPDATE taxi_dispatches SET status='rejected' WHERE request_id=$1 AND provider_id=$2",
      [s.id, u.id],
    );
    await db.query(
      "UPDATE service_requests SET provider_id=NULL,vehicle_id=NULL,agreed_price=NULL WHERE id=$1",
      [s.id],
    );
    await event(db, u, s, "published", "Водитель отказался; поиск продолжен");
  }
  return { id: s.id, status: s.status };
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
