export const vehicleLabels = {
  sedan: "Легковой автомобиль",
  minivan: "Минивэн",
  van: "Грузовой фургон",
  truck: "Грузовик",
  dump_truck: "Самосвал",
  semi_trailer: "Фура",
  crane: "Автокран",
  excavator: "Экскаватор",
  loader: "Погрузчик",
} as const;
export type VehicleKind = keyof typeof vehicleLabels;
export const serviceLabels = {
  taxi: "Такси",
  cargo: "Грузоперевозки",
  equipment: "Спецтехника",
} as const;
export type ServiceKind = keyof typeof serviceLabels;
export const serviceVehicles: Record<ServiceKind, VehicleKind[]> = {
  taxi: ["sedan", "minivan"],
  cargo: ["van", "truck", "dump_truck", "semi_trailer"],
  equipment: ["crane", "excavator", "loader", "dump_truck"],
};
export const serviceStatuses: Record<string, string> = {
  driver_pending: "Ожидаем ответа водителя",
  published: "Поиск исполнителя",
  assigned: "Исполнитель выбран",
  en_route_to_pickup: "Исполнитель едет к заказчику",
  arrived: "Исполнитель прибыл",
  in_progress: "Выполняется",
  awaiting_confirmation: "Ожидает подтверждения заказчика",
  completed: "Завершён",
  cancelled: "Отменён",
};
