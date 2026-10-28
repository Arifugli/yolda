"use client";
import { useEffect, useRef, useState } from "react";
type Point = { lat: string; lng: string };
export type TaxiPoints = { origin: Point; destination: Point };
export default function TaxiMap({
  points,
  setPoints,
  t,
  single = false,
}: {
  single?: boolean;
  points: TaxiPoints;
  setPoints: (p: TaxiPoints) => void;
  t: (s: string) => string;
}) {
  const node = useRef<HTMLDivElement>(null),
    map = useRef<import("leaflet").Map | null>(null),
    latest = useRef({ points, setPoints });
  const [target, setTarget] = useState<keyof TaxiPoints>("origin"),
    [error, setError] = useState("");
  const currentTarget = useRef(target);
  latest.current = { points, setPoints };
  currentTarget.current = target;
  useEffect(() => {
    let disposed = false,
      markers: import("leaflet").CircleMarker[] = [];
    void import("leaflet")
      .then((L) => {
        if (disposed || !node.current) return;
        const m = L.map(node.current).setView([40.386, 71.786], 12);
        map.current = m;
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          maxZoom: 19,
          referrerPolicy: "strict-origin-when-cross-origin",
        }).addTo(m);
        m.on("click", (e: import("leaflet").LeafletMouseEvent) => {
          const key = currentTarget.current;
          latest.current.setPoints({
            ...latest.current.points,
            [key]: {
              lat: e.latlng.lat.toFixed(6),
              lng: e.latlng.lng.toFixed(6),
            },
          });
          if (key === "origin" && !single) setTarget("destination");
        });
        const redraw = () => {
          markers.forEach((marker) => marker.remove());
          markers = [];
          for (const [key, p] of Object.entries(latest.current.points))
            if (p.lat && p.lng) {
              markers.push(
                L.circleMarker([Number(p.lat), Number(p.lng)], {
                  radius: 10,
                  color: key === "origin" ? "#176e58" : "#c37d31",
                  fillOpacity: 0.9,
                })
                  .bindTooltip(key === "origin" ? "A" : "B", {
                    permanent: true,
                  })
                  .addTo(m),
              );
            }
        };
        redraw();
        m.on("yolda:points", redraw);
      })
      .catch(() =>
        setError(t("Карта не загрузилась. Укажите координаты вручную.")),
      );
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    map.current?.fire("yolda:points");
  }, [points]);
  function locate() {
    if (!navigator.geolocation) {
      setError(t("Геопозиция недоступна"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPoints({
          ...points,
          origin: {
            lat: p.coords.latitude.toFixed(6),
            lng: p.coords.longitude.toFixed(6),
          },
        });
        map.current?.setView([p.coords.latitude, p.coords.longitude], 15);
        if (!single) setTarget("destination");
        setError("");
      },
      () => setError(t("Разрешите геопозицию или выберите точку на карте.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  }
  return (
    <div className="taxi-map-panel">
      <div className="service-tabs">
        <button
          type="button"
          className={target === "origin" ? "button" : "button secondary"}
          onClick={() => setTarget("origin")}
        >
          {t("A · Откуда")}
        </button>
        {!single && (
          <button
            type="button"
            className={target === "destination" ? "button" : "button secondary"}
            onClick={() => setTarget("destination")}
          >
            {t("B · Куда")}
          </button>
        )}
        <button type="button" className="text-button" onClick={locate}>
          {t("Моё местоположение")}
        </button>
      </div>
      <p>
        {t(
          single
            ? "Выберите место работы на карте."
            : "Выберите две точки на карте. Расстояние и тариф MVP рассчитаны по прямой, дорожный маршрут пока не строится.",
        )}
      </p>
      <div
        ref={node}
        className="taxi-map"
        aria-label={t("Карта выбора маршрута")}
      />
      <details>
        <summary>{t("Координаты точек")}</summary>
        <div className="form-grid">
          {(
            (single
              ? ["origin"]
              : ["origin", "destination"]) as (keyof TaxiPoints)[]
          ).map((key) => (
            <fieldset key={key}>
              <legend>{t(key === "origin" ? "Откуда" : "Куда")}</legend>
              {(["lat", "lng"] as const).map((axis) => (
                <label key={axis}>
                  {t(axis === "lat" ? "Широта" : "Долгота")}
                  <input
                    aria-label={`${key} ${axis}`}
                    type="number"
                    step="any"
                    min={axis === "lat" ? -90 : -180}
                    max={axis === "lat" ? 90 : 180}
                    value={points[key][axis]}
                    onChange={(e) =>
                      setPoints({
                        ...points,
                        [key]: { ...points[key], [axis]: e.target.value },
                      })
                    }
                  />
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </details>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
