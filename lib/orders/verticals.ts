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
// Delivery/freight/equipment stay behind their legacy adapters until P1.
// Register only implemented verticals; no simulated availability of future services.
export const verticals: Partial<Record<ServiceType, Vertical>> = {
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
