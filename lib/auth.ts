import { createHash, randomBytes } from "node:crypto";
import { pool } from "./db";
import type { PoolClient } from "pg";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type User = {
  id: string;
  public_id: string;
  name: string;
  phone: string;
  phone_verified: boolean;
  identity: string;
  dob: string;
  role: string;
  restricted: boolean;
  profile: Record<string, unknown>;
};
export async function authenticate(session: string | null): Promise<User> {
  if (!session) throw new AppError(401, "Войдите в аккаунт");
  const r = await pool.query(
    "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [hash(session)],
  );
  if (!r.rowCount) throw new AppError(401, "Сессия истекла");
  if (r.rows[0].restricted) throw new AppError(403, "Аккаунт ограничен");
  return r.rows[0];
}
export async function verified(db: PoolClient, u: User) {
  const r = await db.query(
    "SELECT identity,restricted FROM users WHERE id=$1 FOR SHARE",
    [u.id],
  );
  if (r.rows[0]?.identity !== "verified" || r.rows[0].restricted)
    throw new AppError(403, "Необходима подтвержденная личность");
  if (
    process.env.APP_MODE !== "demo" ||
    process.env.DEPLOYMENT_ENV === "production"
  ) {
    const v = (
      await db.query(
        "SELECT provider,result FROM identity_verifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
        [u.id],
      )
    ).rows[0];
    if (v?.provider !== "myid" || v?.result !== "verified")
      throw new AppError(
        403,
        "В production требуется реальная проверка MyID; демонстрационный статус не принимается",
      );
  }
}
export function requireRole(u: User, roles: string[]) {
  if (!roles.includes(u.role)) throw new AppError(403, "Недостаточно прав");
}
