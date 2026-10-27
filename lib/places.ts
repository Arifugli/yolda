export type Place = {
  lat: number;
  lng: number;
  address: string;
  city: string;
  district?: string;
};
export const cityCenters: Record<string, [number, number]> = {
  Фергана: [40.386, 71.786],
  Коканд: [40.528, 70.942],
  Андижан: [40.782, 72.344],
  Наманган: [40.998, 71.672],
  Ташкент: [41.311, 69.279],
};
export function cityAt(lat: number, lng: number, fallback = "") {
  let nearest = fallback,
    distance = Infinity;
  for (const [city, [a, b]] of Object.entries(cityCenters)) {
    const d = Math.hypot(lat - a, (lng - b) * Math.cos((lat * Math.PI) / 180));
    if (d < distance && d < 0.23) {
      distance = d;
      nearest = city;
    }
  }
  return nearest;
}
export function mapPlace(lat: number, lng: number, city = ""): Place {
  return {
    lat,
    lng,
    address: "Точка на карте",
    city: cityAt(lat, lng, city) || "Узбекистан",
  };
}
