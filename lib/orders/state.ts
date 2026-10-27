import { AppError } from "../auth";
export type OrderState =
  | "created"
  | "searching"
  | "offered"
  | "accepted"
  | "en_route_to_pickup"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled";
export const transitions: Record<OrderState, readonly OrderState[]> = {
  created: ["searching", "cancelled"],
  searching: ["offered", "cancelled"],
  offered: ["accepted", "searching", "cancelled"],
  accepted: ["en_route_to_pickup", "searching", "cancelled"],
  en_route_to_pickup: ["arrived", "searching", "cancelled"],
  arrived: ["in_progress", "searching", "cancelled"],
  in_progress: ["completed"],
  completed: [],
  cancelled: [],
};
export function canonicalState(status: string): OrderState {
  const aliases: Record<string, OrderState> = {
    published: "searching",
    driver_pending: "offered",
    assigned: "accepted",
    awaiting_confirmation: "in_progress",
  };
  const state = aliases[status] ?? status;
  if (!(state in transitions))
    throw new AppError(409, "Неизвестное состояние заказа");
  return state as OrderState;
}
export function assertTransition(from: string, to: string) {
  const a = canonicalState(from),
    b = canonicalState(to);
  // Delivery/execution confirmation is an internal substep, not a second start.
  if (from === "in_progress" && to === "awaiting_confirmation") return;
  if (!transitions[a].includes(b))
    throw new AppError(409, "Действие недоступно на текущем этапе");
}
