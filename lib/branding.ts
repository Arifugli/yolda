import { pool } from "./db";
export async function brandName() {
  try {
    const r = await pool.query(
      "SELECT data->>'name' name FROM settings WHERE id=1",
    );
    return r.rows[0]?.name ?? process.env.NEXT_PUBLIC_APP_NAME ?? "Yolda";
  } catch {
    return process.env.NEXT_PUBLIC_APP_NAME ?? "Yolda";
  }
}
