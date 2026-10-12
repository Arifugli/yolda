import { pool } from "./db";
import { AppError } from "./auth";
export async function rate(key: string, limit: number, seconds: number) {
  const r = await pool.query(
    `INSERT INTO rate_limits(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.window_start < now()-make_interval(secs=>$2) THEN 1 ELSE rate_limits.count+1 END, window_start=CASE WHEN rate_limits.window_start < now()-make_interval(secs=>$2) THEN now() ELSE rate_limits.window_start END RETURNING count`,
    [key, seconds],
  );
  if (r.rows[0].count > limit)
    throw new AppError(429, "Слишком много запросов. Попробуйте позже");
}
