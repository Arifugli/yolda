import { z } from "zod";
export const pointSchema = z.object({
  kind: z.enum(["person", "point", "locker"]),
  city: z.string().min(1),
  district: z.string().min(1).max(100),
  address: z.string().min(3).max(300),
  lat: z.number().min(39).max(42),
  lng: z.number().min(69).max(74),
  lockerId: z.string().optional(),
});
export const shipmentSchema = z.object({
  origin: pointSchema,
  destination: pointSchema,
  recipient: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(3).max(1000),
  weight: z.number().positive(),
  dimensions: z.tuple([
    z.number().positive(),
    z.number().positive(),
    z.number().positive(),
  ]),
  declaredValue: z.number().int().nonnegative(),
  fragile: z.boolean(),
  pickupAt: z.iso.datetime(),
  deliverBy: z.iso.datetime(),
  instruction: z.string().max(500),
  payer: z.enum(["sender", "recipient"]),
  allowedContents: z.literal(true),
  packaging: z.literal(true),
  urgent: z.boolean().default(false),
  photos: z.array(z.uuid()).max(6).default([]),
});
export type ShipmentInput = z.infer<typeof shipmentSchema>;
