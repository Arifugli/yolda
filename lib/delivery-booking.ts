import { z } from "zod";
import { pointSchema, shipmentSchema } from "./schema";
import { parcelOptions } from "./booking-options";
import { mapsProvider } from "./providers";
import { AppError } from "./auth";
const address = pointSchema
  .omit({ kind: true, lockerId: true })
  .extend({ district: z.string().min(1).max(100).default("Точка на карте") });
export const deliveryRouteSchema = z.object({
  origin: address,
  destination: address,
  parcel: z.enum(["small", "medium", "large"]),
});
export const deliveryBookingSchema = deliveryRouteSchema.extend({
  recipient: z.string().regex(/^\+998\d{9}$/),
  description: z.string().trim().min(3).max(1000).default("Посылка"),
  quotedPrice: z.number().int().positive(),
  allowedContents: z.literal(true),
  packaging: z.literal(true),
});
export function deliveryQuote(body: unknown, settings: any) {
  const b = deliveryRouteSchema.parse(body),
    parcel = parcelOptions[b.parcel];
  for (const p of [b.origin, b.destination]) {
    const zone = settings.zones[p.city];
    if (
      !settings.cities.includes(p.city) ||
      !zone ||
      mapsProvider.estimate([zone.lat, zone.lng], [p.lat, p.lng]).km >
        zone.radiusKm
    )
      throw new AppError(
        400,
        "Доставка пока доступна в Фергане, Коканде, Андижане и Намангане. Выберите адрес в зоне обслуживания.",
      );
  }
  if (b.origin.city !== b.destination.city)
    throw new AppError(400, "Пока доставляем в пределах одного города");
  if (
    parcel.weight > settings.maxWeight ||
    Math.max(...parcel.dimensions) > settings.maxDimension
  )
    throw new AppError(400, "Выберите посылку меньшего размера");
  const estimate = mapsProvider.estimate(
    [b.origin.lat, b.origin.lng],
    [b.destination.lat, b.destination.lng],
  );
  const delivery = Math.round(
      settings.base +
        estimate.km * settings.perKm +
        parcel.weight * settings.perKg,
    ),
    fee = Math.round(delivery * settings.commission);
  return { price: delivery + fee, distanceKm: estimate.km, approximate: true };
}
export function deliveryInput(b: z.infer<typeof deliveryBookingSchema>) {
  const parcel = parcelOptions[b.parcel];
  return shipmentSchema.parse({
    origin: { ...b.origin, kind: "person" },
    destination: { ...b.destination, kind: "person" },
    recipient: b.recipient,
    description: b.description,
    category: "Посылка",
    weight: parcel.weight,
    dimensions: [...parcel.dimensions],
    declaredValue: 0,
    fragile: false,
    pickupAt: new Date().toISOString(),
    deliverBy: new Date(Date.now() + 21600000).toISOString(),
    instruction: "",
    payer: "sender",
    allowedContents: b.allowedContents,
    packaging: b.packaging,
    urgent: false,
    photos: [],
  });
}
