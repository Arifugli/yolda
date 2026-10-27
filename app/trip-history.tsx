"use client";
import { useEffect, useState } from "react";
import { serviceStatuses } from "@/lib/mobility-catalog";
export default function TripHistory({
  api,
  t,
  open,
}: {
  api: (p: string) => Promise<any>;
  t: (s: string) => string;
  open: (s: any) => void;
}) {
  const [trips, setTrips] = useState<any[]>([]);
  useEffect(() => {
    let active = true;
    void api("mobility?kind=taxi&view=mine")
      .then((rows) => {
        if (active) setTrips(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api]);
  if (!trips.length) return null;
  return (
    <section className="trip-history">
      <h2>{t("Поездки на такси")}</h2>
      {trips.slice(0, 15).map((s) => (
        <button className="active-booking" key={s.id} onClick={() => open(s)}>
          <span className="address-round">↗</span>
          <span>
            <b>{s.data.destination?.address}</b>
            <small>{t(serviceStatuses[s.status])}</small>
          </span>
          <span>›</span>
        </button>
      ))}
    </section>
  );
}
