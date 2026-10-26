"use client";
import { useEffect, useRef, useState } from "react";
type Row = Record<string, any>;
export default function TaxiAvailability({
  api,
  t,
  open,
}: {
  api: (path: string, body?: any) => Promise<any>;
  t: (s: string) => string;
  open: (id: string) => void;
}) {
  const [vehicles, setVehicles] = useState<Row[]>([]),
    [vehicleId, setVehicleId] = useState(""),
    [online, setOnline] = useState(false);
  const [incoming, setIncoming] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [fresh, setFresh] = useState(false),
    [consent, setConsent] = useState(false);
  const fix = useRef<GeolocationPosition | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      api("mobility/vehicles")
        .then((v) => {
          if (active)
            setVehicles(
              v.filter(
                (r: Row) => r.active && ["sedan", "minivan"].includes(r.kind),
              ),
            );
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, online]);
  useEffect(() => {
    let active = true;
    const load = () =>
      api("mobility/presence")
        .then((p) => {
          if (active) setIncoming(p.incoming);
        })
        .catch(() => {});
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api]);
  useEffect(() => {
    if (!online) return;
    if (!navigator.geolocation) {
      setError(t("Геопозиция недоступна"));
      setOnline(false);
      return;
    }
    let active = true,
      sending = false;
    const heartbeat = async () => {
      if (!active || sending) return;
      const p = fix.current;
      if (
        document.visibilityState !== "visible" ||
        !p ||
        Date.now() - p.timestamp > 60000 ||
        p.coords.accuracy > 200
      ) {
        setFresh(false);
        return;
      }
      sending = true;
      try {
        await api("mobility/presence", {
          online: true,
          vehicleId,
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          consent: true,
        });
        if (active) {
          setFresh(true);
          setError("");
        }
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          setFresh(false);
          setOnline(false);
        }
      } finally {
        sending = false;
      }
    };
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        fix.current = p;
        void heartbeat();
      },
      () => {
        if (active) {
          setError(t("Разрешите геопозицию. Приём заказов остановлен."));
          setOnline(false);
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
    );
    const timer = setInterval(heartbeat, 20000);
    return () => {
      active = false;
      clearInterval(timer);
      navigator.geolocation.clearWatch(watch);
      setFresh(false);
      void api("mobility/presence", { online: false }).catch(() => {});
    };
  }, [online, vehicleId, api]);
  return (
    <details
      className="card service-detail taxi-availability"
      open={online || incoming.length > 0 ? true : undefined}
    >
      <summary>
        {t("Я водитель такси")} ·{" "}
        {t(online && fresh ? "На линии" : "Не на линии")}
      </summary>
      <p>
        {t(
          "Добавьте машину в «Услуги → Такси → Мои машины». Приём работает с разрешённой геопозицией, пока приложение открыто на экране. Без обновления позиции водитель исключается из поиска через две минуты.",
        )}
      </p>
      <label>
        {t("Машина для такси")}
        <select
          aria-label={t("Машина для такси")}
          disabled={online}
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
        >
          <option value="">{t("Выберите машину")}</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.data.name} · {v.data.plate}
            </option>
          ))}
        </select>
      </label>
      <label className="service-consent">
        <input
          type="checkbox"
          checked={consent}
          disabled={online}
          onChange={(e) => setConsent(e.target.checked)}
        />
        {t(
          "Разрешаю передавать текущую геопозицию для подбора поездок, пока я на линии.",
        )}
      </label>
      <button
        type="button"
        disabled={!online && (!vehicleId || !consent)}
        className={online ? "button secondary" : "button"}
        onClick={() => {
          setError("");
          setOnline((v) => !v);
        }}
      >
        {t(online ? "Уйти с линии" : "Выйти на линию")}
      </button>
      {online && !fresh && (
        <p role="status">{t("Ожидаем свежую точную геопозицию…")}</p>
      )}
      {error && <p role="alert">{t(error)}</p>}
      {incoming.map((s) => (
        <div className="service-offer" key={s.id}>
          <div>
            <b>
              {t("Новая поездка")}:{" "}
              {new Intl.NumberFormat("ru-UZ").format(s.agreed_price)} {t("сум")}
            </b>
            <p>
              {s.data.origin.address} → {s.data.destination.address}
            </p>
            <p>{t("Ответьте в течение 45 секунд")}</p>
          </div>
          <button type="button" className="button" onClick={() => open(s.id)}>
            {t("Открыть поездку")}
          </button>
        </div>
      ))}
    </details>
  );
}
