import {
  deliveryBookingSchema,
  deliveryRouteSchema,
} from "../delivery-booking";
import { z } from "zod";
import { serviceRequestSchema } from "../mobility-schema";
import { rideRoute } from "./pricing";
export type ServiceType = "ride" | "delivery" | "freight" | "equipment";
export interface Vertical {
  type: ServiceType;
  parameters: z.ZodType;
  route: z.ZodType;
  tariff: string;
  vehicleKinds: readonly string[];
}
// Freight/equipment stay behind legacy adapters until their migration.
// Register only implemented verticals; no simulated availability of future services.
export const verticals: Partial<Record<ServiceType, Vertical>> = {
  delivery: {
    type: "delivery",
    parameters: deliveryBookingSchema,
    route: deliveryRouteSchema,
    tariff: "parcel",
    vehicleKinds: ["walk", "bike", "scooter", "car"],
  },
  ride: {
    type: "ride",
    parameters: serviceRequestSchema.refine(
      (v) => v.kind === "taxi",
      "Неверная услуга",
    ),
    route: rideRoute,
    tariff: "economy",
    vehicleKinds: ["sedan", "minivan"],
  },
};
