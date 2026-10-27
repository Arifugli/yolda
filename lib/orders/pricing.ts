import { z } from "zod";
import type { PoolClient } from "pg";
import { AppError } from "../auth";
import { distanceKm } from "../distance";
const coordinate = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export const rideRoute = z.object({
  origin: coordinate,
  destination: coordinate,
});
const rulesSchema = z.object({
  base: z.number().int().nonnegative(),
  perKm: z.number().nonnegative(),
  minimum: z.number().int().positive(),
  roundTo: z.number().int().positive(),
  maxKm: z.number().positive().max(1000),
});
export function calculateRide(body: unknown, rawRules: unknown) {
  const b = rideRoute.parse(body),
    rules = rulesSchema.parse(rawRules),
    km = distanceKm(b.origin, b.destination);
  if (km < 0.05 || km > rules.maxKm)
    throw new AppError(400, "Расстояние вне диапазона тарифа");
  const price = Math.max(
    rules.minimum,
    Math.ceil((rules.base + km * rules.perKm) / rules.roundTo) * rules.roundTo,
  );
  if (!Number.isSafeInteger(price) || price > 1000000000)
    throw new AppError(503, "Тариф временно недоступен");
  return { price, distanceKm: Math.round(km * 100) / 100, approximate: true };
}
export async function quoteRide(db: PoolClient, body: unknown) {
  const tariff = (
    await db.query(
      "SELECT * FROM order_tariffs WHERE service_type='ride' AND code='economy' AND active FOR SHARE",
    )
  ).rows[0];
  if (!tariff) throw new AppError(503, "Тариф временно недоступен");
  return {
    ...calculateRide(body, tariff.rules),
    tariffCode: tariff.code,
    tariffVersion: tariff.version,
    rules: tariff.rules,
    currency: "UZS",
  };
}
