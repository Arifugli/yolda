export const parcelOptions = {
  small: {
    label: "Небольшая",
    hint: "до 1 кг · 20 × 15 × 10 см",
    weight: 1,
    dimensions: [20, 15, 10],
  },
  medium: {
    label: "Средняя",
    hint: "до 5 кг · 40 × 30 × 20 см",
    weight: 5,
    dimensions: [40, 30, 20],
  },
  large: {
    label: "Большая",
    hint: "до 10 кг · 60 × 40 × 40 см",
    weight: 10,
    dimensions: [60, 40, 40],
  },
} as const;
