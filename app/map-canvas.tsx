"use client";
import { useEffect, useRef, useState } from "react";
import type { Place } from "@/lib/places";
export default function MapCanvas({
  focus,
  executor = null,
  origin,
  destination,
  selecting,
  bottomInset,
  onMove,
  t = (text: string) => text,
}: {
  focus: { lat: number; lng: number };
  executor?: { lat: number; lng: number; updated_at: string } | null;
  origin: Place | null;
  destination: Place | null;
  selecting: boolean;
  bottomInset: number;
  onMove: (lat: number, lng: number) => void;
  t?: (text: string) => string;
}) {
  const node = useRef<HTMLDivElement>(null),
    map = useRef<import("leaflet").Map | null>(null),
    layer = useRef<import("leaflet").LayerGroup | null>(null),
    latest = useRef({ selecting, onMove, focus });
  const [unavailable, setUnavailable] = useState(false);
  latest.current = { selecting, onMove, focus };
  useEffect(() => {
    let cancelled = false;
    void import("leaflet")
      .then((L) => {
        if (cancelled || !node.current) return;
        const initialFocus = latest.current.focus;
        const m = L.map(node.current, {
          zoomControl: false,
          attributionControl: true,
        }).setView([initialFocus.lat, initialFocus.lng], 15);
        map.current = m;
        layer.current = L.layerGroup().addTo(m);
        const tiles = L.tileLayer(
          "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            maxZoom: 19,
            referrerPolicy: "strict-origin-when-cross-origin",
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
          },
        ).addTo(m);
        tiles.on("tileerror", () => setUnavailable(true));
        tiles.on("tileload", () => setUnavailable(false));
        m.on("moveend", () => {
          if (latest.current.selecting) {
            const p = m.getCenter();
            latest.current.onMove(p.lat, p.lng);
          }
        });
        m.on("click", (e: import("leaflet").LeafletMouseEvent) => {
          if (latest.current.selecting) m.panTo(e.latlng, { animate: false });
        });
        m.fire("yolda:ready");
      })
      .catch(() => setUnavailable(true));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (m) m.setView([focus.lat, focus.lng], 16, { animate: false });
  }, [focus.lat, focus.lng, selecting]);
  useEffect(() => {
    let active = true;
    const draw = async () => {
      const L = await import("leaflet");
      if (!active || !map.current || !layer.current) return;
      layer.current.clearLayers();
      if (!selecting) {
        for (const [label, p] of [
          ["A", origin],
          ["B", destination],
        ] as const)
          if (p)
            L.marker([p.lat, p.lng], {
              icon: L.divIcon({
                className: "route-dot " + label.toLowerCase(),
                html: `<span>${label}</span>`,
                iconSize: [34, 34],
                iconAnchor: [17, 17],
              }),
            }).addTo(layer.current);
        if (origin && destination) {
          L.polyline(
            [
              [origin.lat, origin.lng],
              [destination.lat, destination.lng],
            ],
            { color: "#17735c", weight: 4, dashArray: "7 9", opacity: 0.65 },
          ).addTo(layer.current);
          map.current.fitBounds(
            [
              [origin.lat, origin.lng],
              [destination.lat, destination.lng],
            ],
            {
              paddingTopLeft: [map.current.getSize().x >= 800 ? 450 : 35, 95],
              paddingBottomRight: [
                35,
                map.current.getSize().x >= 800
                  ? 45
                  : Math.min(bottomInset + 25, map.current.getSize().y - 180),
              ],
              maxZoom: 16,
              animate: false,
            },
          );
        }
      }
    };
    void draw();
    const m = map.current;
    m?.on("yolda:ready", draw);
    const timer = setTimeout(draw, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      m?.off("yolda:ready", draw);
    };
  }, [
    origin?.lat,
    origin?.lng,
    destination?.lat,
    destination?.lng,
    selecting,
    bottomInset,
  ]);
  useEffect(() => {
    let active = true;
    let marker: import("leaflet").Marker | undefined;
    void import("leaflet").then((L) => {
      if (!active || !map.current || !executor || selecting) return;
      marker = L.marker([executor.lat, executor.lng], {
        icon: L.divIcon({
          className: "executor-dot",
          html: "<span>➤</span>",
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        }),
      }).addTo(map.current);
      marker.bindTooltip(t("Исполнитель"));
    });
    return () => {
      active = false;
      marker?.remove();
    };
  }, [executor?.lat, executor?.lng, executor?.updated_at, selecting]);
  return (
    <div className="booking-map-wrap">
      <div
        ref={node}
        className="booking-map"
        aria-label={t("Карта маршрута")}
      />
      {selecting && (
        <div className="center-pin" aria-hidden="true">
          <span />
          <i />
        </div>
      )}
      {unavailable && (
        <div className="map-connection">
          {t("Карта недоступна. Можно найти адрес или повторить позже.")}
        </div>
      )}
    </div>
  );
}
