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
// Verticals share the state machine, with service-specific validated parameters.
export const verticals: Partial<Record<ServiceType, Vertical>> = {
  freight: {
    type: "freight",
    parameters: serviceRequestSchema.refine((v) => v.kind === "cargo"),
    route: rideRoute,
    tariff: "vehicle",
    vehicleKinds: ["van", "truck", "dump_truck", "semi_trailer"],
  },
  equipment: {
    type: "equipment",
    parameters: serviceRequestSchema.refine((v) => v.kind === "equipment"),
    route: rideRoute.pick({ origin: true }),
    tariff: "hourly",
    vehicleKinds: ["crane", "excavator", "loader", "dump_truck"],
  },
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
