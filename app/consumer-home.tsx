"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
const MapCanvas = dynamic(() => import("./map-canvas"), { ssr: false });
import { mapPlace, cityCenters, type Place } from "@/lib/places";
import ServiceArt from "./service-art";
type Row = Record<string, any>;
export default function ConsumerHome({
  user,
  name,
  api,
  t,
  pickup,
  setPickup,
  book,
  navigate,
  openDelivery,
  openTaxi,
}: {
  user: Row;
  name: string;
  api: (p: string, b?: any) => Promise<any>;
  t: (s: string) => string;
  pickup: Place | null;
  setPickup: (p: Place) => void;
  book: (kind: "taxi" | "delivery", destination?: Place) => void;
  navigate: (tab: string) => void;
  openDelivery: (id: string) => void;
  openTaxi: (id: string) => void;
}) {
  const [recent, setRecent] = useState<Place[]>([]),
    [active, setActive] = useState<Row[]>([]);
  const [ordersError, setOrdersError] = useState(false),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    try {
      setRecent(
        JSON.parse(
          localStorage.getItem("yolda:places:" + user.id) ?? "[]",
        ).slice(0, 3),
      );
    } catch {}
  }, [user.id]);
  useEffect(() => {
    let cancelled = false;
    if (pickup || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        const point = mapPlace(
          p.coords.latitude,
          p.coords.longitude,
          user.profile.city,
        );
        let address = point;
        try {
          address =
            (
              await api(`places?mode=reverse&lat=${point.lat}&lng=${point.lng}`)
            )[0] ?? point;
        } catch {}
        if (!cancelled) setPickup(address);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
    return () => {
      cancelled = true;
    };
  }, [user.id]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setOrdersError(false);
    void Promise.all([api("shipments"), api("mobility?kind=taxi&view=mine")])
      .then(([deliveries, taxis]) => {
        if (live)
          setActive(
            [
              ...taxis
                .filter(
                  (s: Row) =>
                    s.customer_id === user.id &&
                    !["completed", "cancelled"].includes(s.status),
                )
                .map((s: Row) => ({ ...s, bookingType: "taxi" })),
              ...deliveries
                .filter(
                  (s: Row) =>
                    s.sender_id === user.id &&
                    !["completed", "cancelled", "returned"].includes(s.status),
                )
                .map((s: Row) => ({ ...s, bookingType: "delivery" })),
            ].slice(0, 3),
          );
      })
      .catch(() => {
        if (live) setOrdersError(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [user.id, retry]);
  const center = cityCenters[user.profile.city] ?? cityCenters["Фергана"];
  return (
    <section className="consumer-home">
      <MapCanvas
        focus={pickup ?? { lat: center[0], lng: center[1] }}
        origin={pickup}
        destination={null}
        selecting={false}
        bottomInset={0}
        onMove={() => {}}
        t={t}
      />
      <header className="consumer-header">
        <button
          className="round-button"
          aria-label={t("Открыть профиль")}
          onClick={() => navigate("profile")}
        >
          <span className="hamburger">☰</span>
        </button>
        <div className="consumer-brand">
          <a href="/" aria-label={name}>
            <strong>
              {name}
              <em aria-hidden="true">•</em>
            </strong>
          </a>
          <button onClick={() => book("taxi")}>
            {pickup?.address ?? t("Укажите ваше местоположение")} <span>›</span>
          </button>
        </div>
        <button
          className="consumer-avatar"
          aria-label={t("Профиль")}
          onClick={() => navigate("profile")}
        >
          {user.name.slice(0, 1)}
        </button>
      </header>
      <div className="home-service-sheet" aria-label={t("Услуги и заказы")}>
        <div className="sheet-handle" aria-hidden="true" />
        <h1>{t("Куда отправимся сегодня?")}</h1>
        <div className="consumer-services">
          <button
            className="service-tile taxi"
            aria-label={t("Такси")}
            onClick={() => book("taxi")}
          >
            <ServiceArt kind="taxi" />
            <span>
              {t("Такси")} <small>{t("Поездка по городу")}</small>
            </span>
          </button>
          <button
            className="service-tile delivery"
            aria-label={t("Доставка")}
            onClick={() => book("delivery")}
          >
            <ServiceArt kind="delivery" />
            <span>
              {t("Доставка")} <small>{t("Посылки от двери до двери")}</small>
            </span>
          </button>
          <button
            className="service-tile compact"
            aria-label={t("Грузоперевозки")}
            onClick={() => navigate("cargo")}
          >
            <ServiceArt kind="cargo" />
            <span>{t("Грузоперевозки")}</span>
          </button>
          <button
            className="service-tile compact"
            aria-label={t("Спецтехника")}
            onClick={() => navigate("equipment")}
          >
            <ServiceArt kind="equipment" />
            <span>{t("Спецтехника")}</span>
          </button>
        </div>
        <button className="destination-prompt" onClick={() => book("taxi")}>
          <span className="search-symbol" /> {t("Куда едем?")} <span>›</span>
        </button>
        {recent.length > 0 && (
          <div className="home-addresses">
            {recent.map((p, i) => (
              <button key={p.address + i} onClick={() => book("taxi", p)}>
                <span className="address-round">↗</span>
                <span>
                  <b>{p.address}</b>
                  <small>{p.city}</small>
                </span>
                <span>›</span>
              </button>
            ))}
          </div>
        )}
        {loading && <p role="status">{t("Загружаем заказы…")}</p>}
        {ordersError && (
          <div role="alert">
            {t("Не удалось загрузить заказы")}{" "}
            <button onClick={() => setRetry((v) => v + 1)}>
              {t("Повторить")}
            </button>
          </div>
        )}
        {active.length > 0 && (
          <div className="consumer-active">
            <div className="section-heading">
              <h2>{t("Ваши заказы")}</h2>
              <button onClick={() => navigate("orders")}>{t("Все")} ›</button>
            </div>
            {active.map((s) => (
              <button
                className="active-booking"
                key={s.id}
                onClick={() =>
                  s.bookingType === "taxi" ? openTaxi(s.id) : openDelivery(s.id)
                }
              >
                <span className="address-round">
                  {s.bookingType === "taxi" ? "↗" : "□"}
                </span>
                <span>
                  <b>
                    {t(
                      s.bookingType === "taxi"
                        ? "Поездка на такси"
                        : "Доставка",
                    )}
                  </b>
                  <small>{s.data.destination?.address}</small>
                </span>
                <span>›</span>
              </button>
            ))}
          </div>
        )}
        <button className="consumer-work" onClick={() => navigate("work")}>
          <span>↗</span>
          <div>
            <b>{t("Зарабатывайте с Yolda")}</b>
            <p>{t("Принимайте поездки, доставки и заказы на технику")}</p>
          </div>
          <span>›</span>
        </button>
        <p className="consumer-demo">
          {t("Демоверсия · оплата и SMS имитируются")}
        </p>
      </div>
    </section>
  );
}
