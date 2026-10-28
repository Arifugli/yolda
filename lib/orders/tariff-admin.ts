import { z } from "zod";
import type { PoolClient } from "pg";
import { AppError, requireRole, type User } from "../auth";
import { pool } from "../db";
const rules = z
  .object({
    base: z.number().int().min(0).max(100000000),
    perKm: z.number().min(0).max(1000000),
    perHour: z.number().min(0).max(10000000).optional(),
    minimum: z.number().int().positive().max(1000000000),
    roundTo: z.number().int().positive().max(1000000),
    maxKm: z.number().positive().max(1000),
  })
  .strict();
export const tariffUpdate = z
  .object({
    serviceType: z.enum(["ride", "freight", "equipment"]),
    code: z.string().regex(/^[a-z0-9_-]{1,80}$/),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(5).max(500),
    rules,
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.serviceType !== "ride" && b.rules.perHour === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["rules", "perHour"],
        message: "Укажите ставку за час",
      });
    if (
      (b.serviceType !== "equipment" && (b.rules.perHour ?? 0) !== 0) ||
      (b.serviceType === "equipment" && b.rules.perKm !== 0)
    )
      ctx.addIssue({
        code: "custom",
        path: ["rules"],
        message: "Ставка не соответствует услуге",
      });
    const maximum =
      b.rules.base +
      (b.serviceType === "equipment"
        ? 720 * (b.rules.perHour ?? 0)
        : b.rules.maxKm * b.rules.perKm);
    if (Math.ceil(maximum / b.rules.roundTo) * b.rules.roundTo > 1000000000)
      ctx.addIssue({
        code: "custom",
        path: ["rules"],
        message: "Цена превышает допустимый предел",
      });
  });
export async function listTariffs(u: User) {
  requireRole(u, ["admin"]);
  return (
    await pool.query(
      "SELECT service_type,code,version,rules,active,created_at FROM order_tariffs ORDER BY active DESC,service_type,code,version DESC LIMIT 500",
    )
  ).rows;
}
export async function updateTariff(db: PoolClient, u: User, body: unknown) {
  requireRole(u, ["admin"]);
  const b = tariffUpdate.parse(body);
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "tariff:" + b.serviceType + ":" + b.code,
  ]);
  const current = (
    await db.query(
      "SELECT * FROM order_tariffs WHERE service_type=$1 AND code=$2 AND active FOR UPDATE",
      [b.serviceType, b.code],
    )
  ).rows[0];
  if (!current) throw new AppError(404, "Тариф не найден");
  if (current.version !== b.expectedVersion)
    throw new AppError(
      409,
      "Тариф уже изменён. Обновите список перед сохранением.",
    );
  const next = current.version + 1;
  await db.query(
    "UPDATE order_tariffs SET active=false WHERE service_type=$1 AND code=$2 AND version=$3",
    [b.serviceType, b.code, current.version],
  );
  await db.query(
    "INSERT INTO order_tariffs(service_type,code,version,rules) VALUES($1,$2,$3,$4)",
    [b.serviceType, b.code, next, JSON.stringify(b.rules)],
  );
  await db.query(
    "INSERT INTO audit_logs(actor_id,action,detail) VALUES($1,'tariff.update',$2)",
    [
      u.id,
      JSON.stringify({
        serviceType: b.serviceType,
        code: b.code,
        fromVersion: current.version,
        toVersion: next,
        before: current.rules,
        after: b.rules,
        reason: b.reason,
      }),
    ],
  );
  return { serviceType: b.serviceType, code: b.code, version: next };
}
