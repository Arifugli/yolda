import { pool, transaction } from "../db";
import { dispatchTaxi } from "../taxi";
import { dispatchOrder } from "./matching";
// Select identifiers first; each order is its own bounded transaction. Delivery always locks
// shipment before order, matching the HTTP command lock order. SKIP LOCKED permits replicas.
export async function dispatchTick() {
  const rows = (
    await pool.query(`SELECT id,kind FROM orders WHERE (kind IN ('taxi','delivery') OR (kind IN ('cargo','equipment') AND engine_version=1 AND data->>'matchingMode'='auto')) AND status IN ('published','driver_pending')
 AND (kind='delivery' OR (data->>'scheduledAt')::timestamptz<=now()+interval '20 minutes') ORDER BY updated_at LIMIT 50`)
  ).rows;
  let failures = 0;
  for (const item of rows) {
    try {
      await transaction(async (db) => {
        await db.query("SET LOCAL lock_timeout='2s'");
        await db.query("SET LOCAL statement_timeout='8s'");
        if (
          item.kind === "delivery" &&
          !(
            await db.query(
              "SELECT id FROM shipments WHERE id=$1 FOR UPDATE SKIP LOCKED",
              [item.id],
            )
          ).rowCount
        )
          return;
        const s = (
          await db.query(
            "SELECT * FROM orders WHERE id=$1 FOR UPDATE SKIP LOCKED",
            [item.id],
          )
        ).rows[0];
        if (!s || !["published", "driver_pending"].includes(s.status)) return;
        const u = (
          await db.query("SELECT * FROM users WHERE id=$1", [s.customer_id])
        ).rows[0];
        if (!u || u.restricted) return;
        if (s.kind !== "delivery") await dispatchTaxi(db, u, s);
        else await dispatchOrder(db, u, s);
        // Round-robin across waiting orders, including no-match results.
        await db.query("UPDATE orders SET updated_at=now() WHERE id=$1", [
          s.id,
        ]);
      });
    } catch {
      failures++;
    } // Do not log addresses, phone numbers, credentials or SQL parameters.
  }
  return { checked: rows.length, failures };
}
