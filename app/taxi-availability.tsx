"use client";
import { useEffect, useRef, useState } from "react";
import { serviceVehicles, type ServiceKind } from "@/lib/mobility-catalog";
type Row = Record<string, any>;
export default function TaxiAvailability({
  api,
  t,
  open,
  kind = "taxi",
}: {
  kind?: ServiceKind;
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
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const fix = useRef<GeolocationPosition | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      api("mobility/vehicles")
        .then((v) => {
          if (active)
            setVehicles(
              v.filter(
                (r: Row) => r.active && serviceVehicles[kind].includes(r.kind),
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
  }, [api, online, kind]);
  useEffect(() => {
    let active = true;
    const load = () =>
      api("mobility/presence?kind=" + kind)
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
  }, [api, kind]);
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
          kind,
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
      void api("mobility/presence", { online: false, kind }).catch(() => {});
    };
  }, [online, vehicleId, api, kind]);
  return (
    <details
      className={
        "card service-detail " +
        (kind === "taxi" ? "taxi-availability" : "heavy-availability")
      }
      open={online || incoming.length > 0 ? true : undefined}
    >
      <summary>
        {t(kind === "taxi" ? "Я водитель такси" : "Приём заказов на машину")} ·{" "}
        {t(online && fresh ? "На линии" : "Не на линии")}
      </summary>
      <p>
        {t(
          kind === "taxi"
            ? "Добавьте машину в «Услуги → Такси → Мои машины». Приём работает с разрешённой геопозицией, пока приложение открыто на экране. Без обновления позиции водитель исключается из поиска через две минуты."
            : "Добавьте машину в разделе «Мои машины». Геопозиция обновляется, пока приложение открыто; без обновления исполнитель исключается из поиска через две минуты.",
        )}
      </p>
      <label>
        {t(kind === "taxi" ? "Машина для такси" : "Машина для заказов")}
        <select
          aria-label={t(
            kind === "taxi" ? "Машина для такси" : "Машина для заказов",
          )}
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
          "Разрешаю передавать текущую геопозицию для подбора заказов, пока я на линии.",
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
              {t(kind === "taxi" ? "Новая поездка" : "Новый заказ")}:{" "}
              {new Intl.NumberFormat("ru-UZ").format(s.agreed_price)} {t("сум")}
            </b>
            <p>
              {s.data.origin.address} →{" "}
              {s.data.destination?.address ?? t("Работы на объекте")}
            </p>
            <p>
              {t("Осталось секунд")}:{" "}
              {Math.max(0, Math.ceil((Date.parse(s.expires_at) - now) / 1000))}
            </p>
          </div>
          <button type="button" className="button" onClick={() => open(s.id)}>
            {t(kind === "taxi" ? "Открыть поездку" : "Открыть заказ")}
          </button>
        </div>
      ))}
    </details>
  );
}
