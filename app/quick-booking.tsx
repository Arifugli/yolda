"use client";
import { useEffect, useRef, useState } from "react";
import { cityCenters, mapPlace, type Place } from "@/lib/places";
import { parcelOptions } from "@/lib/booking-options";
import MapCanvas from "./map-canvas";
type Row = Record<string, any>;
type Api = (path: string, body?: any) => Promise<any>;
type Kind = "taxi" | "delivery";
const money = (n: number) => new Intl.NumberFormat("ru-UZ").format(n) + " сум";
export default function QuickBooking({
  kind,
  name,
  user,
  api,
  t,
  initialPickup,
  initialDestination,
  initialId,
  close,
  details,
  onPickup,
}: {
  kind: Kind;
  name: string;
  user: Row;
  api: Api;
  t: (s: string) => string;
  initialPickup: Place | null;
  initialDestination?: Place;
  initialId?: string;
  close: () => void;
  details: (id: string) => void;
  onPickup: (p: Place) => void;
}) {
  const [origin, setOrigin] = useState<Place | null>(initialPickup),
    [destination, setDestination] = useState<Place | null>(
      initialDestination ?? null,
    ),
    [editing, setEditing] = useState<"origin" | "destination" | null>(null);
  const center = cityCenters[user.profile.city] ?? cityCenters["Фергана"];
  const [focus, setFocus] = useState({
      lat: initialPickup?.lat ?? center[0],
      lng: initialPickup?.lng ?? center[1],
    }),
    [pin, setPin] = useState(
      mapPlace(
        initialPickup?.lat ?? center[0],
        initialPickup?.lng ?? center[1],
        user.profile.city,
      ),
    );
  const [quote, setQuote] = useState<Row | null>(null),
    [loadingPrice, setLoadingPrice] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [locationState, setLocationState] = useState("");
  const [parcel, setParcel] = useState<keyof typeof parcelOptions>("small"),
    [recipient, setRecipient] = useState("+998"),
    [description, setDescription] = useState(""),
    [consent, setConsent] = useState(false),
    [passengers, setPassengers] = useState(1);
  const [id, setId] = useState<string | null>(initialId ?? null),
    [order, setOrder] = useState<Row | null>(null),
    [code, setCode] = useState(""),
    [chat, setChat] = useState(false),
    [recent, setRecent] = useState<Place[]>([]),
    [revision, setRevision] = useState(0);
  const manual = useRef(false),
    locationVersion = useRef(0);
  const submitting = useRef(false),
    pendingBooking = useRef<{ signature: string; body: Row } | null>(null),
    sheet = useRef<HTMLElement | null>(null);
  const [sheetHeight, setSheetHeight] = useState(
    kind === "delivery" ? 540 : 390,
  );
  useEffect(() => {
    const element = sheet.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setSheetHeight(Math.round(element.getBoundingClientRect().height)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [editing, id]);
  const endpoint = kind === "taxi" ? "mobility/" : "shipments/";
  async function reverse(p: Place) {
    try {
      return (
        (await api(`places?mode=reverse&lat=${p.lat}&lng=${p.lng}`))[0] ?? p
      );
    } catch {
      return p;
    }
  }
  function locate() {
    if (!navigator.geolocation) {
      setLocationState("Выберите место подачи на карте или найдите адрес");
      return;
    }
    const version = ++locationVersion.current;
    setLocationState("Определяем ваше местоположение…");
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        if (version !== locationVersion.current) return;
        const position = mapPlace(
          p.coords.latitude,
          p.coords.longitude,
          user.profile.city,
        );
        setFocus(position);
        setPin(position);
        if (!manual.current) {
          setOrigin(position);
          onPickup(position);
        }
        const address = await reverse(position);
        if (version !== locationVersion.current) return;
        if (!manual.current) {
          setOrigin(address);
          onPickup(address);
        }
        setPin(address);
        setLocationState("");
      },
      () => {
        if (version === locationVersion.current)
          setLocationState("Разрешите геопозицию или выберите адрес вручную");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  }
  useEffect(() => {
    try {
      setRecent(
        JSON.parse(
          localStorage.getItem("yolda:places:" + user.id) ?? "[]",
        ).slice(0, 4),
      );
    } catch {}
    if (!initialPickup && !initialId) locate();
    return () => {
      locationVersion.current++;
    };
  }, []);
  useEffect(() => {
    if (id || !origin || !destination) return;
    let active = true;
    setQuote(null);
    setLoadingPrice(true);
    setError("");
    const body =
      kind === "taxi"
        ? { origin, destination }
        : { origin, destination, parcel };
    api(kind === "taxi" ? "mobility/quote" : "delivery.quote", body)
      .then((r) => {
        if (active) setQuote(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoadingPrice(false);
      });
    return () => {
      active = false;
    };
  }, [id, origin, destination, parcel, kind, api]);
  useEffect(() => {
    if (!id) return;
    let active = true;
    const load = async () => {
      try {
        let s = await api(endpoint + id);
        if (
          kind === "taxi" &&
          s.customer_id === user.id &&
          ["published", "driver_pending"].includes(s.status)
        ) {
          await api(endpoint + id + "/dispatch", {});
          s = await api(endpoint + id);
        }
        if (active) {
          setOrder(s);
          setOrigin(s.data.origin);
          setDestination(s.data.destination);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(load, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, revision, kind, api]);
  function edit(which: "origin" | "destination") {
    manual.current = true;
    locationVersion.current++;
    setError("");
    const p =
      (which === "origin" ? origin : destination) ??
      origin ??
      mapPlace(focus.lat, focus.lng, user.profile.city);
    setFocus(p);
    setPin(p);
    setEditing(which);
  }
  function select(p: Place) {
    setQuote(null);
    if (editing === "origin") {
      setOrigin(p);
      onPickup(p);
    } else setDestination(p);
    setEditing(null);
    setError("");
  }
  function remember(a: Place, b: Place) {
    try {
      const old: Place[] = JSON.parse(
        localStorage.getItem("yolda:places:" + user.id) ?? "[]",
      );
      const points = [b, a, ...old]
        .filter(
          (p, i, all) =>
            all.findIndex(
              (q) =>
                Math.abs(q.lat - p.lat) < 0.0001 &&
                Math.abs(q.lng - p.lng) < 0.0001,
            ) === i,
        )
        .slice(0, 4);
      localStorage.setItem("yolda:places:" + user.id, JSON.stringify(points));
    } catch {}
  }
  async function submit() {
    if (submitting.current || busy || !origin || !destination || !quote) return;
    submitting.current = true;
    manual.current = true;
    locationVersion.current++;
    setBusy(true);
    setError("");
    try {
      const signature = JSON.stringify({
        kind,
        from: [origin.lat, origin.lng],
        to: [destination.lat, destination.lng],
        parcel,
        recipient,
        description,
        passengers,
        consent,
        price: quote.price,
      });
      if (pendingBooking.current?.signature !== signature)
        pendingBooking.current = {
          signature,
          body:
            kind === "taxi"
              ? {
                  kind: "taxi",
                  vehicleKind: passengers > 4 ? "minivan" : "sedan",
                  origin,
                  destination,
                  description: "Поездка на такси",
                  publicSummary: "Поездка на такси",
                  scheduledAt: new Date().toISOString(),
                  passengers,
                  budget: quote.price,
                  safetyConfirmed: true,
                }
              : {
                  origin,
                  destination,
                  parcel,
                  recipient,
                  description: description.trim() || "Посылка",
                  quotedPrice: quote.price,
                  allowedContents: consent,
                  packaging: consent,
                },
        };
      const r = await api(
        kind === "taxi" ? "mobility" : "delivery.book",
        pendingBooking.current.body,
      );
      remember(origin, destination);
      pendingBooking.current = null;
      setId(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function action(name: string, body: Row = {}) {
    if (!id || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api(endpoint + id + "/" + name, body);
      if (r.code) setCode(r.code);
      setRevision((n) => n + 1);
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const state = order?.status,
    done = ["completed", "cancelled", "returned"].includes(state),
    customer =
      kind === "taxi"
        ? order?.customer_id === user.id
        : order?.sender_id === user.id;
  const statusText: Record<string, string> = {
    published: kind === "taxi" ? "Ищем водителя" : "Ищем курьера",
    driver_pending: "Водитель подтверждает поездку",
    assigned:
      kind === "taxi" ? "Водитель едет к вам" : "Курьер едет за посылкой",
    arrived: "Водитель на месте",
    pickup_arrived: "Курьер на месте",
    in_progress: "Хорошей поездки!",
    picked_up: "Посылка у курьера",
    in_transit: "Посылка в пути",
    destination_arrived: "Курьер прибыл к получателю",
    awaiting_receipt: "Получатель забирает посылку",
    received: "Посылка передана",
    awaiting_confirmation: "Вы приехали",
    completed: kind === "taxi" ? "Поездка завершена" : "Посылка доставлена",
    cancelled: "Заказ отменён",
    returned: "Посылка возвращена",
    delivery_failed: "Нужна помощь с доставкой",
    return_agreed: "Возвращаем посылку",
    returning: "Посылка возвращается",
  };
  const providerId = kind === "taxi" ? order?.provider_id : order?.courier_id,
    provider = order?.participants?.find((p: Row) => p.id === providerId);
  return (
    <div className="quick-booking" data-kind={kind}>
      <MapCanvas
        focus={focus}
        origin={origin}
        destination={destination}
        selecting={!!editing}
        bottomInset={sheetHeight}
        onMove={(lat, lng) =>
          setPin(mapPlace(lat, lng, origin?.city ?? user.profile.city))
        }
      />
      {!editing ? (
        <>
          <header className="booking-header">
            <button
              className="round-button"
              aria-label={t("На главную")}
              onClick={close}
            >
              ←
            </button>
            <span className="booking-brand">
              {name} <b>{t(kind === "taxi" ? "Такси" : "Доставка")}</b>
            </span>
          </header>
          <button
            className="map-locate round-button"
            aria-label={t("Моё местоположение")}
            onClick={() => {
              if (id) {
                if (origin) setFocus(origin);
              } else {
                manual.current = false;
                locate();
              }
            }}
          >
            ➤
          </button>
          <section
            className="booking-sheet"
            ref={sheet}
            aria-label={t(kind === "taxi" ? "Заказ такси" : "Заказ доставки")}
          >
            <div className="sheet-handle" />
            {id ? (
              <>
                <div className="booking-status">
                  <span className={done ? "status-orb done" : "status-orb"}>
                    {done ? "✓" : "↗"}
                  </span>
                  <div>
                    <h1>{t(statusText[state] ?? "Загружаем заказ…")}</h1>
                    <p>
                      {provider?.name ??
                        t(
                          done
                            ? "Спасибо, что выбрали Yolda"
                            : "Уведомим здесь, когда статус изменится",
                        )}
                    </p>
                  </div>
                </div>
                <div className="booked-route">
                  <p>
                    <i className="mini-dot a" />
                    {origin?.address}
                  </p>
                  <p>
                    <i className="mini-dot b" />
                    {destination?.address}
                  </p>
                </div>
                {!!order && (
                  <p className="booked-price">
                    {money(
                      kind === "taxi"
                        ? (order.agreed_price ?? order.data.budget)
                        : order.data.price.total,
                    )}{" "}
                    <small>{t("Демо-оплата")}</small>
                  </p>
                )}
                {customer &&
                  ((kind === "taxi" && state === "arrived") ||
                    (kind === "delivery" && state === "pickup_arrived")) && (
                    <button
                      className="booking-primary"
                      disabled={busy}
                      onClick={() =>
                        action(
                          "code",
                          kind === "delivery" ? { stage: "pickup" } : {},
                        )
                      }
                    >
                      {t(
                        kind === "taxi"
                          ? "Получить код начала"
                          : "Код передачи курьеру",
                      )}
                    </button>
                  )}
                {kind === "delivery" &&
                  order?.recipient_id === user.id &&
                  state === "awaiting_receipt" && (
                    <button
                      className="booking-primary"
                      disabled={busy}
                      onClick={() => action("code", { stage: "delivery" })}
                    >
                      {t("Код получения посылки")}
                    </button>
                  )}
                {code &&
                  ["arrived", "pickup_arrived", "awaiting_receipt"].includes(
                    state,
                  ) && (
                    <div className="booking-code" role="status">
                      <small>
                        {t("Назовите код при встрече · действует 5 минут")}
                      </small>
                      <strong>{code}</strong>
                    </div>
                  )}
                {((kind === "taxi" &&
                  customer &&
                  state === "awaiting_confirmation") ||
                  (kind === "delivery" &&
                    order?.recipient_id === user.id &&
                    state === "received")) && (
                  <button
                    className="booking-primary"
                    disabled={busy || order?.dispute_status === "open"}
                    onClick={() => action("complete")}
                  >
                    {t(
                      kind === "taxi"
                        ? "Завершить поездку"
                        : "Подтвердить получение",
                    )}
                  </button>
                )}
                {kind === "delivery" && order && !order.recipient_id && (
                  <p className="booking-hint">
                    {t(
                      "Получателю нужно войти в Yolda по указанному номеру. Доставка появится у него автоматически.",
                    )}
                  </p>
                )}
                <div className="booking-actions">
                  {!!providerId && (
                    <button onClick={() => setChat((v) => !v)}>
                      {t("Написать")}
                    </button>
                  )}
                  <button onClick={() => details(id)}>
                    {t("Детали заказа")}
                  </button>
                  {customer &&
                    [
                      "published",
                      "driver_pending",
                      "assigned",
                      "arrived",
                      "pickup_arrived",
                    ].includes(state) && (
                      <button disabled={busy} onClick={() => action("cancel")}>
                        {t("Отменить")}
                      </button>
                    )}
                </div>
                {chat && (
                  <div className="compact-chat">
                    <div>
                      {order?.messages?.slice(-8).map((m: Row) => (
                        <p key={m.id}>
                          <b>{m.name}</b> {m.text}
                        </p>
                      ))}
                    </div>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        if (
                          await action("message", {
                            text: new FormData(form).get("text"),
                          })
                        )
                          form.reset();
                      }}
                    >
                      <input
                        aria-label={t("Сообщение")}
                        name="text"
                        required
                        maxLength={1000}
                        placeholder={t("Написать сообщение")}
                      />
                      <button disabled={busy}>{t("Отправить")}</button>
                    </form>
                  </div>
                )}
                {done && (
                  <button className="booking-primary" onClick={close}>
                    {t("На главную")}
                  </button>
                )}
              </>
            ) : (
              <>
                <h1>{t(kind === "taxi" ? "Такси" : "Доставка")}</h1>
                <div className="route-fields">
                  <button
                    aria-label={t(
                      kind === "taxi"
                        ? "Изменить место подачи"
                        : "Изменить адрес отправления",
                    )}
                    onClick={() => edit("origin")}
                  >
                    <i className="mini-dot a" />
                    <span>{origin?.address ?? t("Откуда забрать?")}</span>
                    <b>›</b>
                  </button>
                  <button
                    className={!destination ? "empty" : ""}
                    aria-label={t(
                      kind === "taxi"
                        ? "Выбрать пункт назначения"
                        : "Выбрать адрес доставки",
                    )}
                    onClick={() => edit("destination")}
                  >
                    <i className="mini-dot b" />
                    <span>
                      {destination?.address ??
                        t(kind === "taxi" ? "Куда едем?" : "Куда доставить?")}
                    </span>
                    <b>›</b>
                  </button>
                </div>
                {locationState && !origin && (
                  <p className="booking-hint" role="status">
                    {t(locationState)}
                  </p>
                )}
                {kind === "taxi" ? (
                  <div className="ride-options">
                    <span>
                      🚕 <b>{t("Город")}</b>
                      <small>{t("Ближайшая свободная машина")}</small>
                    </span>
                    <label>
                      {t("Пассажиров")}
                      <select
                        aria-label={t("Количество пассажиров")}
                        value={passengers}
                        onChange={(e) => setPassengers(Number(e.target.value))}
                      >
                        {[1, 2, 3, 4, 5, 6].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : (
                  <>
                    <div className="parcel-options">
                      {Object.entries(parcelOptions).map(([key, p]) => (
                        <button
                          key={key}
                          className={parcel === key ? "selected" : ""}
                          onClick={() =>
                            setParcel(key as keyof typeof parcelOptions)
                          }
                        >
                          <b>{t(p.label)}</b>
                          <small>{p.hint}</small>
                        </button>
                      ))}
                    </div>
                    <div className="delivery-essentials">
                      <label>
                        {t("Телефон получателя")}
                        <input
                          type="tel"
                          autoComplete="tel"
                          onBlur={() => {
                            const digits = recipient.replace(/\D/g, "");
                            if (digits.length === 9)
                              setRecipient("+998" + digits);
                            else if (
                              digits.length === 12 &&
                              digits.startsWith("998")
                            )
                              setRecipient("+" + digits);
                          }}
                          placeholder="+998 90 000 00 00"
                          value={recipient}
                          onChange={(e) =>
                            setRecipient(e.target.value.replace(/[\s()-]/g, ""))
                          }
                        />
                      </label>
                      <label>
                        {t("Что отправляем?")}
                        <input
                          value={description}
                          maxLength={1000}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder={t("Например, документы или подарок")}
                        />
                      </label>
                    </div>
                    <label className="parcel-consent">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      <span>
                        {t("Посылка упакована, запрещённых предметов нет")}
                      </span>
                    </label>
                  </>
                )}
                <div className="booking-payment">
                  <span>▣ {t("Демо-оплата")}</span>
                  <small>{t("Без списания денег")}</small>
                </div>
                <button
                  className="booking-primary"
                  disabled={
                    busy ||
                    !quote ||
                    loadingPrice ||
                    !origin ||
                    !destination ||
                    (kind === "delivery" &&
                      (!/^\+998\d{9}$/.test(recipient) || !consent))
                  }
                  onClick={submit}
                >
                  {t(
                    busy
                      ? "Заказываем…"
                      : loadingPrice
                        ? "Считаем стоимость…"
                        : kind === "taxi"
                          ? "Заказать такси"
                          : "Заказать доставку",
                  )}
                  {quote && !busy && !loadingPrice && (
                    <span> · {money(quote.price)}</span>
                  )}
                </button>
                <p className="booking-fare-note">
                  {t(
                    "Стоимость рассчитана по прямой. Платёж демонстрационный.",
                  )}
                </p>
              </>
            )}
            {error && (
              <div className="booking-error" role="alert">
                {t(error)}
              </div>
            )}
          </section>
        </>
      ) : (
        <AddressPicker
          target={editing}
          kind={kind}
          api={api}
          t={t}
          center={pin}
          recent={recent}
          close={() => setEditing(null)}
          select={select}
          focus={(p) => {
            setFocus(p);
            setPin(p);
          }}
          reverse={reverse}
        />
      )}
    </div>
  );
}
function AddressPicker({
  target,
  kind,
  api,
  t,
  center,
  recent,
  close,
  select,
  focus,
  reverse,
}: {
  target: "origin" | "destination";
  kind: Kind;
  api: Api;
  t: (s: string) => string;
  center: Place;
  recent: Place[];
  close: () => void;
  select: (p: Place) => void;
  focus: (p: Place) => void;
  reverse: (p: Place) => Promise<Place>;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Place[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [mapMode, setMapMode] = useState(true);
  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 3) return;
    setBusy(true);
    setError("");
    setMapMode(false);
    try {
      const p = await api(
        `places?q=${encodeURIComponent(query)}&lat=${center.lat}&lng=${center.lng}`,
      );
      setResults(p);
      if (!p.length)
        setError(
          "Адрес не найден. Уточните запрос или выберите точку на карте.",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="address-picker">
        <header>
          <button
            className="round-button"
            aria-label={t("Назад к заказу")}
            onClick={close}
          >
            ←
          </button>
          <h1>
            {t(
              target === "origin"
                ? "Откуда забрать?"
                : kind === "taxi"
                  ? "Куда едем?"
                  : "Куда доставить?",
            )}
          </h1>
        </header>
        <form onSubmit={search}>
          <span className="search-symbol" />
          <input
            aria-label={t("Поиск адреса")}
            placeholder={t("Улица, дом или название места")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setMapMode(false);
              setResults([]);
            }}
          />
          <button
            disabled={busy || query.trim().length < 3}
            aria-label={t("Найти адрес")}
          >
            {busy ? "…" : "→"}
          </button>
        </form>
        <button
          className="choose-on-map"
          onClick={() => {
            setMapMode(true);
            setResults([]);
            setError("");
          }}
        >
          <i className="mini-dot b" />
          {t("Выбрать на карте")}
        </button>
        {!mapMode && (
          <div className="address-results">
            {(query ? results : recent).map((p, i) => (
              <button
                key={i + p.address}
                onClick={() => {
                  focus(p);
                  select(p);
                }}
              >
                <span className="address-round">↗</span>
                <span>
                  <b>{p.address}</b>
                  <small>{p.city}</small>
                </span>
                <span>›</span>
              </button>
            ))}
            {error && <p role="alert">{t(error)}</p>}
          </div>
        )}
      </section>
      {mapMode && (
        <section className="pin-confirm">
          <small>{t("Двигайте карту, чтобы выбрать точку")}</small>
          <p>
            {t(center.address)} · {center.city}
          </p>
          <button
            className="booking-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              select(await reverse(center));
            }}
          >
            {t(busy ? "Определяем адрес…" : "Подтвердить адрес")}
          </button>
        </section>
      )}
    </>
  );
}
