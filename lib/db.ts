import pg from "pg";
const globalDb = globalThis as unknown as { pool: pg.Pool };
export const pool =
  globalDb.pool ??
  new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgres://yolda:yolda_local@localhost:5432/yolda",
    max: 10,
  });
if (process.env.NODE_ENV !== "production") globalDb.pool = pool;
export async function transaction<T>(
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
