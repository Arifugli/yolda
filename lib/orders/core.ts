import type { PoolClient } from "pg";
import type { User } from "../auth";
import { assertTransition, canonicalState } from "./state";
export type OrderRecord = {
  id: string;
  status: string;
  engine_version: number;
};
// The caller holds the order row lock and has checked command-specific permissions.
// All state writes for engine v1 use this boundary in the existing transaction.
export async function changeOrderState(
  db: PoolClient,
  u: User,
  s: OrderRecord,
  status: string,
  detail: string,
) {
  const from = s.status;
  if (s.engine_version === 1) assertTransition(from, status);
  await db.query(
    "UPDATE orders SET status=$2,updated_at=now(),cancellation_reason=CASE WHEN $2='cancelled' THEN $3 ELSE cancellation_reason END WHERE id=$1",
    [s.id, status, detail],
  );
  s.status = status;
  if (s.engine_version === 1)
    await db.query(
      "INSERT INTO order_events(order_id,actor_id,from_state,to_state,detail) VALUES($1,$2,$3,$4,$5)",
      [s.id, u.id, canonicalState(from), canonicalState(status), detail],
    );
}
export async function initializeOrder(db: PoolClient, u: User, s: OrderRecord) {
  await db.query(
    "INSERT INTO order_events(order_id,actor_id,to_state,detail) VALUES($1,$2,'created','Заказ создан')",
    [s.id, u.id],
  );
  await changeOrderState(db, u, s, "published", "Начат поиск исполнителя");
}
