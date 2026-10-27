import { z } from "zod";
import { AppError } from "./auth";
import { cityAt, type Place } from "./places";
const point = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
const cache = new Map<string, { expires: number; places: Place[] }>();
let queue = Promise.resolve(),
  queued = 0,
  lastStart = 0;
// Explicit searches only: Nominatim forbids autocomplete. One request/second per Render instance.
async function request(url: URL): Promise<any> {
  if (queued >= 8)
    throw new AppError(
      429,
      "Поиск занят. Повторите через несколько секунд или выберите точку на карте.",
    );
  queued++;
  const result = queue.then(async () => {
    const wait = 1100 - (Date.now() - lastStart);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart = Date.now();
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent":
            process.env.GEOCODING_USER_AGENT ??
            "Yolda/0.1 (https://yolda-mvp.onrender.com)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error();
      return await r.json();
    } catch {
      throw new AppError(
        503,
        "Поиск адресов временно недоступен. Выберите точку на карте.",
      );
    } finally {
      queued--;
    }
  });
  queue = result.then(
    () => {},
    () => {},
  );
  return result;
}
function parse(row: any): Place | null {
  if (!row || typeof row !== "object") return null;
  const lat = Number(row.lat),
    lng = Number(row.lon),
    a = row.address ?? {};
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  )
    return null;
  return {
    lat,
    lng,
    address: (
      [
        a.road ?? a.pedestrian ?? a.residential ?? a.neighbourhood,
        a.house_number,
      ]
        .filter(Boolean)
        .join(" ") ||
      row.name ||
      row.display_name ||
      "Точка на карте"
    ).slice(0, 300),
    city: cityAt(
      lat,
      lng,
      String(a.city ?? a.town ?? a.village ?? a.municipality ?? "Узбекистан"),
    ).slice(0, 80),
    district: String(
      a.suburb ?? a.city_district ?? a.district ?? "Район на карте",
    ).slice(0, 100),
  };
}
export async function geocode(params: URLSearchParams) {
  const reverse = params.get("mode") === "reverse",
    base = new URL(
      process.env.GEOCODING_URL ?? "https://nominatim.openstreetmap.org/",
    );
  if (base.protocol !== "https:") throw new Error("Geocoding requires HTTPS");
  const url = new URL(
    reverse ? "reverse" : "search",
    base.toString().replace(/\/?$/, "/"),
  );
  for (const [k, v] of Object.entries({
    format: "jsonv2",
    addressdetails: "1",
    "accept-language": "ru",
  }))
    url.searchParams.set(k, v);
  if (reverse) {
    const p = point.parse(Object.fromEntries(params));
    url.searchParams.set("lat", p.lat.toFixed(5));
    url.searchParams.set("lon", p.lng.toFixed(5));
  } else {
    url.searchParams.set(
      "q",
      z.string().trim().min(3).max(200).parse(params.get("q")),
    );
    url.searchParams.set("countrycodes", "uz");
    url.searchParams.set("limit", "5");
    if (params.has("lat") && params.has("lng")) {
      const p = point.parse(Object.fromEntries(params));
      url.searchParams.set(
        "viewbox",
        `${p.lng - 0.35},${p.lat + 0.25},${p.lng + 0.35},${p.lat - 0.25}`,
      );
    }
  }
  const key = url.toString(),
    old = cache.get(key);
  if (old && old.expires > Date.now()) return old.places;
  const rows = await request(url),
    places = (reverse ? [rows] : Array.isArray(rows) ? rows : [])
      .map(parse)
      .filter((p): p is Place => p !== null);
  if (cache.size >= 250) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 1200000, places });
  return places;
}
