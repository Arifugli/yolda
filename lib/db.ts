import pg from "pg";
const globalDb = globalThis as unknown as { pool: pg.Pool };
let connectionString =
  process.env.DATABASE_URL ??
  "postgres://yolda:yolda_local@localhost:5432/yolda";
const requireTLS = process.env.DATABASE_SSL === "true";
if (requireTLS) {
  // pg connection-string SSL options otherwise override the explicit verified TLS configuration.
  const url = new URL(connectionString);
  for (const name of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    url.searchParams.delete(name);
  connectionString = url.toString();
}
export const pool =
  globalDb.pool ??
  new pg.Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    ...(requireTLS
      ? {
          ssl: {
            rejectUnauthorized: true,
            ...(process.env.DATABASE_CA_CERT
              ? { ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, "\n") }
              : {}),
          },
        }
      : {}),
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
