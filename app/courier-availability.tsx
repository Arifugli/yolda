"use client";
import { useEffect, useRef, useState } from "react";
type Row = Record<string, any>;
export default function CourierAvailability({
  api,
  t,
  open,
  user,
}: {
  user: Row;
  api: (path: string, body?: any) => Promise<any>;
  t: (s: string) => string;
  open: (id: string) => void;
}) {
  const transport = user.profile.transport ?? "walk";
  const [online, setOnline] = useState(false),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [incoming, setIncoming] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [fresh, setFresh] = useState(false),
    [consent, setConsent] = useState(false);
  const fix = useRef<GeolocationPosition | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      api("delivery/presence")
        .then((p) => {
          if (active) setIncoming(p.incoming);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
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
        await api("delivery/presence", {
          online: true,
          transport,
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
      void api("delivery/presence", { online: false }).catch(() => {});
    };
  }, [online, transport, api]);
  return (
    <details
      className="card service-detail courier-availability"
      open={online || incoming.length > 0 ? true : undefined}
    >
      <summary>
        {t("Я курьер")} · {t(online && fresh ? "На линии" : "Не на линии")}
      </summary>
      <p>
        {t(
          "Включите приём заказов в профиле. Геопозиция передаётся только пока приложение открыто; без обновления курьер исключается из поиска через две минуты.",
        )}
      </p>
      <label className="service-consent">
        <input
          type="checkbox"
          checked={consent}
          disabled={online}
          onChange={(e) => setConsent(e.target.checked)}
        />
        {t(
          "Разрешаю передавать текущую геопозицию для подбора доставок, пока я на линии.",
        )}
      </label>
      <button
        type="button"
        disabled={!online && !consent}
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
              {t("Новая доставка")}:{" "}
              {new Intl.NumberFormat("ru-UZ").format(s.agreed_price)} {t("сум")}
            </b>
            <p>
              {s.origin.address} → {s.destination.address}
            </p>
            <p>
              {t("Осталось секунд")}:{" "}
              {Math.max(
                0,
                Math.ceil((new Date(s.expires_at).getTime() - now) / 1000),
              )}
            </p>
          </div>
          <button
            type="button"
            className="button"
            disabled={busy || new Date(s.expires_at).getTime() <= now}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(`delivery/${s.id}/accept`, {});
                setIncoming((list) => list.filter((row) => row.id !== s.id));
                open(s.id);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Принять доставку")}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(`delivery/${s.id}/reject`, {});
                setIncoming((list) => list.filter((row) => row.id !== s.id));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Отклонить доставку")}
          </button>
        </div>
      ))}
    </details>
  );
}
