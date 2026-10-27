import { z } from "zod";
import { vehicleLabels, serviceVehicles } from "./mobility-catalog";
const positive = z.number().positive().max(100000);
const location = z.object({
  city: z.string().trim().min(2).max(80),
  address: z.string().trim().min(3).max(300),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});
export const vehicleSchema = z
  .object({
    id: z.uuid().optional(),
    kind: z.enum(
      Object.keys(vehicleLabels) as [
        keyof typeof vehicleLabels,
        ...(keyof typeof vehicleLabels)[],
      ],
    ),
    name: z.string().trim().min(2).max(100),
    plate: z.string().trim().min(3).max(30),
    seats: z.number().int().min(1).max(20).default(4),
    capacityTonnes: z.number().min(0).max(1000).default(0),
    liftTonnes: z.number().min(0).max(1000).default(0),
    reachMeters: z.number().min(0).max(300).default(0),
    active: z.boolean().default(true),
    qualificationsConfirmed: z.literal(true),
  })
  .superRefine((v, ctx) => {
    if (
      ["van", "truck", "dump_truck", "semi_trailer"].includes(v.kind) &&
      v.capacityTonnes <= 0
    )
      ctx.addIssue({
        code: "custom",
        path: ["capacityTonnes"],
        message: "Укажите грузоподъёмность",
      });
    if (v.kind === "crane" && (v.liftTonnes <= 0 || v.reachMeters <= 0))
      ctx.addIssue({
        code: "custom",
        path: ["liftTonnes"],
        message: "Укажите параметры крана",
      });
  });
export const serviceRequestSchema = z
  .object({
    kind: z.enum(["taxi", "cargo", "equipment"]),
    vehicleKind: z.enum(
      Object.keys(vehicleLabels) as [
        keyof typeof vehicleLabels,
        ...(keyof typeof vehicleLabels)[],
      ],
    ),
    origin: location,
    destination: location.optional(),
    description: z.string().trim().min(3).max(1500),
    publicSummary: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .default("Заявка на услугу"),
    scheduledAt: z.iso.datetime(),
    passengers: z.number().int().min(1).max(20).default(1),
    weightTonnes: z.number().min(0).max(1000).default(0),
    liftTonnes: z.number().min(0).max(1000).default(0),
    reachMeters: z.number().min(0).max(300).default(0),
    durationHours: positive.max(720).default(1),
    budget: z.number().int().min(1000).max(1000000000),
    quotedTariffVersion: z.number().int().positive().optional(),
    safetyConfirmed: z.literal(true),
  })
  .superRefine((v, ctx) => {
    if (!serviceVehicles[v.kind].includes(v.vehicleKind))
      ctx.addIssue({
        code: "custom",
        path: ["vehicleKind"],
        message: "Неподходящий тип машины",
      });
    if (v.kind !== "equipment" && !v.destination)
      ctx.addIssue({
        code: "custom",
        path: ["destination"],
        message: "Укажите пункт назначения",
      });
    if (
      v.kind === "taxi" &&
      [v.origin.lat, v.origin.lng, v.destination?.lat, v.destination?.lng].some(
        (n) => n === undefined,
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["origin"],
        message: "Для автопоиска такси нужны координаты маршрута",
      });
    if (v.kind === "cargo" && v.weightTonnes <= 0)
      ctx.addIssue({
        code: "custom",
        path: ["weightTonnes"],
        message: "Укажите массу груза",
      });
    if (v.vehicleKind === "crane" && (v.liftTonnes <= 0 || v.reachMeters <= 0))
      ctx.addIssue({
        code: "custom",
        path: ["liftTonnes"],
        message: "Укажите массу подъёма и вылет стрелы",
      });
  });
export type ServiceRequestInput = z.infer<typeof serviceRequestSchema>;
