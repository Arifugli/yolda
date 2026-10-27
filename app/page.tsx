"use client";
import { useEffect, useState, type FormEvent } from "react";
import { uz, statusLabels } from "@/lib/i18n";
import Mobility from "./mobility";
import ConsumerHome from "./consumer-home";
import TripHistory from "./trip-history";
import dynamic from "next/dynamic";
const QuickBooking = dynamic(() => import("./quick-booking"), {
  ssr: false,
  loading: () => (
    <div className="loading">
      <p>Открываем карту…</p>
    </div>
  ),
});
import type { Place } from "@/lib/places";
import TaxiAvailability from "./taxi-availability";
import { serviceLabels, type ServiceKind } from "@/lib/mobility-catalog";
type Any = Record<string, any>;
const enumLabels: Record<string, string> = {
  paid: "Оплачено",
  unpaid: "Не оплачено",
  refund_pending: "Ожидается возврат",
  refunded: "Деньги возвращены",
  pending: "Ожидается",
  blocked: "Выплата заблокирована",
  open: "Открыт",
  resolved: "Решен",
  reserved: "Забронировано",
  deposited: "Помещено",
  collected: "Изъято",
  storage_expired: "Срок хранения истек",
  verified: "Подтверждена",
  unverified: "Не пройдена",
  in_progress: "В процессе",
  reverify: "Повторная проверка",
  rejected: "Отклонена",
  origin: "У отправителя",
  recipient: "У получателя",
  courier: "У курьера",
  sender: "Отправитель",
};
const cities: Record<string, [number, number]> = {
  Фергана: [40.386, 71.786],
  Коканд: [40.528, 70.942],
  Андижан: [40.782, 72.344],
  Наманган: [40.998, 71.672],
};
const money = (n: number) =>
  new Intl.NumberFormat("ru-UZ").format(n ?? 0) + " сум";
const time = (s: string) =>
  new Intl.DateTimeFormat("ru", {
    timeZone: "Asia/Tashkent",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(s));
const pendingMutations = new Map<string, string>();
async function api(path: string, body?: any) {
  const payload =
    body === undefined
      ? undefined
      : body instanceof FormData
        ? body
        : JSON.stringify(body);
  let signature: string | undefined;
  let idempotencyKey = crypto.randomUUID();
  if (typeof payload === "string" && !path.startsWith("auth/")) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(payload),
    );
    signature =
      path +
      ":" +
      Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
    idempotencyKey = pendingMutations.get(signature) ?? idempotencyKey;
    pendingMutations.set(signature, idempotencyKey);
  }
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body instanceof FormData
        ? {}
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
    body: payload,
  });
  const result = await response.json();
  if (response.ok && signature) pendingMutations.delete(signature);
  if (response.ok && (path === "auth/logout" || path === "auth/login"))
    pendingMutations.clear();
  if (!response.ok || result.error) {
    const error = Object.assign(new Error(result.error ?? "Ошибка запроса"), {
      status: response.status,
    });
    throw error;
  }
  return result;
}
function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v10H3z" />
        <path d="M9 20v-7h6v7" />
      </>
    ),
    box: (
      <>
        <path d="m3 7 9-4 9 4v11l-9 4-9-4zM3 7l9 4 9-4M12 11v11M7 5l10 4" />
      </>
    ),
    route: (
      <>
        <circle cx="5" cy="5" r="2" />
        <circle cx="19" cy="19" r="2" />
        <path d="M7 5h9a4 4 0 0 1 0 8H8a3 3 0 0 0 0 6h9" />
      </>
    ),
    chat: <path d="M21 4H3v14h4v4l5-4h9zM7 8h10M7 12h6" />,
    user: (
      <>
        <circle cx="12" cy="7" r="4" />
        <path d="M4 22v-4a8 8 0 0 1 16 0v4" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    pin: (
      <>
        <path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="9" r="2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    bell: (
      <>
        <path d="M5 17h14l-2-3V8a5 5 0 0 0-10 0v6zM10 21h4" />
      </>
    ),
    shield: (
      <>
        <path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z" />
        <path d="m8 11 3 3 5-5" />
      </>
    ),
    plus: <path d="M12 4v16M4 12h16" />,
    star: <path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />,
    logout: <path d="M9 3H3v18h6M9 12h12m-5-5 5 5-5 5" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.box}
    </svg>
  );
}
export default function App() {
  const [user, setUser] = useState<Any | null>(null),
    [me, setMe] = useState<Any>({}),
    [tab, setTab] = useState("home"),
    [lang, setLang] = useState("ru"),
    [orders, setOrders] = useState<Any[]>([]),
    [selected, setSelected] = useState<Any | null>(null),
    [creating, setCreating] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [online, setOnline] = useState(true),
    [receive, setReceive] = useState(false);
  const [serviceKind, setServiceKind] = useState<ServiceKind>("taxi");
  const [serviceRequestId, setServiceRequestId] = useState<string | null>(null);
  const [pickup, setPickup] = useState<Place | null>(null);
  const [booking, setBooking] = useState<{
    kind: "taxi" | "delivery";
    id?: string;
    destination?: Place;
  } | null>(null);
  const [workKind, setWorkKind] = useState("delivery");
  const [authMode, setAuthMode] = useState("demo");
  const t = (s: string) => {
    const label = enumLabels[s] ?? s;
    return lang === "uz"
      ? (uz[label] ?? label).replace(/сум$/u, "so‘m")
      : label;
  };
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  async function reload() {
    try {
      const configuration = await api("config");
      setAuthMode(configuration.authMode ?? "demo");
      setMe((prev: Any) => ({ ...prev, settings: configuration.settings }));
      const m = await api("me");
      setUser(m.user);
      setMe(m);
      setLang(m.user.profile.language ?? "ru");
      setOrders(await api("shipments"));
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    reload();
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      api("shipments")
        .then(setOrders)
        .catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [user?.id]);
  async function run(fn: () => Promise<any>, success = "Готово") {
    setError("");
    setBusy(true);
    try {
      const result = await fn();
      setNotice(success);
      try {
        const configuration = await api("config");
        setAuthMode(configuration.authMode ?? "demo");
        setMe((prev: Any) => ({ ...prev, settings: configuration.settings }));
      } catch {}
      return result;
    } catch (e) {
      setError(t((e as Error).message));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    const s = await run(() => api("shipments/" + id), "");
    if (s) {
      if (
        s.data.quickOrder &&
        [s.sender_id, s.recipient_id].includes(user?.id)
      ) {
        setBooking({ kind: "delivery", id: s.id });
        return;
      }
      setSelected(s);
      setCreating(false);
    }
  }
  async function act(action: string, body: Any = {}) {
    if (!selected) return;
    const result = await run(() =>
      api("shipments/" + selected.id + "/" + action, body),
    );
    if (result) {
      setSelected(await api("shipments/" + selected.id));
      await reload();
    }
    return result;
  }
  const name = me.settings?.name ?? process.env.NEXT_PUBLIC_APP_NAME ?? "Yolda";
  if (!ready)
    return (
      <div className="loading">
        <img src="/icon.svg" alt="" width="64" />
        <p>{t("Загрузка…")}</p>
      </div>
    );
  if (!user)
    return (
      <Login
        authMode={authMode}
        name={name}
        t={t}
        lang={lang}
        setLang={setLang}
        done={reload}
      />
    );
  if (booking)
    return (
      <QuickBooking
        key={booking.kind + ":" + (booking.id ?? "new")}
        kind={booking.kind}
        name={name}
        user={user}
        api={api}
        t={t}
        initialPickup={pickup}
        initialDestination={booking.destination}
        initialId={booking.id}
        onPickup={setPickup}
        close={() => {
          setBooking(null);
          setTab("home");
          void reload();
        }}
        details={async (id) => {
          setBooking(null);
          if (booking.kind === "taxi") {
            setServiceKind("taxi");
            setServiceRequestId(id);
            setTab("services");
          } else {
            const s = await api("shipments/" + id);
            setSelected(s);
            setTab("orders");
          }
        }}
      />
    );
  const tabs = [
    ["home", "home", "Главная"],
    ["orders", "box", "Мои доставки"],
    ["work", "route", "Исполнителям"],
    ["profile", "user", "Профиль"],
  ];
  return (
    <div
      className={
        "shell" +
        (tab === "home" && !selected && !creating ? " consumer-shell" : "")
      }
    >
      <aside className="sidebar">
        <a className="brand" href="/" aria-label={name}>
          <img src="/icon.svg" alt="" />
          {name}
          <span>•</span>
        </a>
        <span className="brand-caption">{t("В пути — вместе")}</span>
        <nav>
          {tabs.map(([id, icon, label]) => (
            <button
              key={id}
              className={
                tab === id && !selected && !creating ? "nav active" : "nav"
              }
              onClick={() => {
                setTab(id);
                setSelected(null);
                setCreating(false);
              }}
            >
              <Icon name={icon} />
              {t(label)}
              {id === "orders" && orders.length > 0 && (
                <span className="counter">{orders.length}</span>
              )}
            </button>
          ))}
          {user.role !== "user" && (
            <button
              className="nav"
              onClick={() => {
                setTab("admin");
                setSelected(null);
                setCreating(false);
              }}
            >
              <Icon name="settings" />
              {t("Администрирование")}
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="trust">
            <Icon name="shield" />
            <p>
              {t("Безопасная доставка из рук в руки")}
              <small>{t("Ферганская долина")}</small>
            </p>
          </div>
          <button
            className="nav"
            onClick={() =>
              run(async () => {
                await api("auth/logout", {});
                setUser(null);
              })
            }
          >
            <Icon name="logout" />
            {t("Выйти")}
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span className="location">
            <Icon name="pin" size={18} />
            {t(user.profile.city ?? "Фергана")}{" "}
            <span className="muted">{t("/ Узбекистан")}</span>
          </span>
          <div className="top-actions">
            <button
              className="language"
              onClick={() => setLang(lang === "ru" ? "uz" : "ru")}
            >
              {lang === "ru" ? "UZ" : "RU"}
            </button>
            <button
              className="icon-button"
              aria-label={t("Уведомления")}
              onClick={() => {
                setTab("notifications");
                setSelected(null);
                setCreating(false);
              }}
            >
              <Icon name="bell" />
            </button>
            <button
              className="avatar"
              onClick={() => {
                setTab("profile");
                setSelected(null);
                setCreating(false);
              }}
            >
              {user.profile.avatarId ? (
                <img src={"/api/avatars/" + user.id} alt={user.name} />
              ) : (
                user.name.slice(0, 1)
              )}
            </button>
          </div>
        </header>
        <div className="demo-banner">
          <span className="live-dot" />
          {t("Демо-режим")}
          <span className="demo-detail">
            {" "}
            · {t("Симуляция личности, оплаты и оборудования")}
          </span>
        </div>
        {!online && (
          <div className="alert">
            {t("Соединение потеряно · последнее состояние")}
          </div>
        )}
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status" onClick={() => setNotice("")}>
            {notice} <span>×</span>
          </div>
        )}
        <div className="content">
          {tab === "work" && (
            <>
              <div
                className="service-tabs"
                aria-label={t("Услуги исполнителя")}
              >
                {[
                  ["delivery", "Доставка"],
                  ["taxi", "Такси"],
                  ["cargo", "Грузоперевозки"],
                  ["equipment", "Спецтехника"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={workKind === id ? "button" : "button secondary"}
                    onClick={() => {
                      setWorkKind(id);
                      setSelected(null);
                      setServiceRequestId(null);
                    }}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
              <div className={workKind === "taxi" ? "" : "driver-panel-hidden"}>
                <TaxiAvailability
                  api={api}
                  t={t}
                  open={(id) => {
                    setWorkKind("taxi");
                    setServiceRequestId(id);
                    setSelected(null);
                    setCreating(false);
                  }}
                />
              </div>
            </>
          )}
          {creating ? (
            <Create
              t={t}
              user={user}
              settings={me.settings}
              cancel={() => setCreating(false)}
              done={async (id: string, invite: string) => {
                setNotice("Приглашение получателю: " + invite);
                await reload();
                await open(id);
              }}
              run={run}
            />
          ) : selected ? (
            <Detail
              t={t}
              user={user}
              initial={selected}
              setSelected={setSelected}
              act={act}
              busy={busy}
              back={() => setSelected(null)}
            />
          ) : (
            <>
              {tab === "home" && (
                <ConsumerHome
                  user={user}
                  name={name}
                  api={api}
                  t={t}
                  pickup={pickup}
                  setPickup={setPickup}
                  book={(kind, destination) =>
                    setBooking({ kind, destination })
                  }
                  navigate={(next) => {
                    if (next === "cargo" || next === "equipment") {
                      setServiceKind(next);
                      setServiceRequestId(null);
                      setTab("services");
                    } else setTab(next);
                  }}
                  openDelivery={open}
                  openTaxi={(id) => setBooking({ kind: "taxi", id })}
                />
              )}
              {tab === "work" &&
                (workKind === "delivery" ? (
                  <Nearby
                    t={t}
                    user={user}
                    run={run}
                    goProfile={() => setTab("profile")}
                  />
                ) : (
                  <Mobility
                    key={workKind + ":" + (serviceRequestId ?? "")}
                    kind={workKind as ServiceKind}
                    initialId={serviceRequestId}
                    user={user}
                    api={api}
                    t={t}
                    onBookTaxi={() => setBooking({ kind: "taxi" })}
                  />
                ))}
              {tab === "orders" && (
                <>
                  <TripHistory
                    api={api}
                    t={t}
                    open={(s) => {
                      if (s.customer_id === user.id)
                        setBooking({ kind: "taxi", id: s.id });
                      else {
                        setWorkKind("taxi");
                        setServiceRequestId(s.id);
                        setTab("work");
                      }
                    }}
                  />
                  <Orders
                    orders={orders}
                    t={t}
                    open={open}
                    create={() => setBooking({ kind: "delivery" })}
                    advanced={() => setCreating(true)}
                    user={user}
                  />
                </>
              )}
              {tab === "services" && (
                <>
                  <div
                    className="service-tabs"
                    role="group"
                    aria-label={t("Направление услуг")}
                  >
                    {(Object.keys(serviceLabels) as ServiceKind[]).map(
                      (kind) => (
                        <button
                          key={kind}
                          className={
                            serviceKind === kind ? "button" : "button secondary"
                          }
                          onClick={() => {
                            setServiceKind(kind);
                            setServiceRequestId(null);
                          }}
                        >
                          {t(serviceLabels[kind])}
                        </button>
                      ),
                    )}
                  </div>
                  <Mobility
                    key={serviceKind + ":" + (serviceRequestId ?? "")}
                    initialId={serviceRequestId}
                    kind={serviceKind}
                    user={user}
                    api={api}
                    t={t}
                    onBookTaxi={() => setBooking({ kind: "taxi" })}
                  />
                </>
              )}
              {tab === "nearby" && (
                <Nearby
                  t={t}
                  user={user}
                  run={run}
                  goProfile={() => setTab("profile")}
                />
              )}
              {tab === "profile" && (
                <>
                  {user.role !== "user" && (
                    <button
                      className="button secondary"
                      onClick={() => setTab("admin")}
                    >
                      {t("Администрирование")}
                    </button>
                  )}
                  <Profile
                    t={t}
                    user={user}
                    me={me}
                    lang={lang}
                    run={run}
                    reload={reload}
                  />
                </>
              )}
              {tab === "messages" && (
                <>
                  <Title
                    title={t("Сообщения")}
                    subtitle={t("Чаты доступны только участникам заказа")}
                  />
                  {orders
                    .filter((o) => o.courier_id)
                    .map((o) => (
                      <button
                        className="conversation card"
                        key={o.id}
                        onClick={() => open(o.id)}
                      >
                        <span className="action-icon mint">
                          <Icon name="chat" />
                        </span>
                        <div>
                          <b>
                            {t(o.data.origin.city)} · {o.data.description}
                          </b>
                          <p>
                            #{o.id.slice(0, 8)} · {t(statusLabels[o.status])}
                          </p>
                        </div>
                        <Icon name="arrow" />
                      </button>
                    ))}
                  {!orders.some((o) => o.courier_id) && (
                    <Empty
                      title={t("Пока нет сообщений")}
                      text={t(
                        "После назначения курьера откройте чат в карточке заказа.",
                      )}
                    />
                  )}
                </>
              )}
              {tab === "notifications" && <Notifications t={t} open={open} />}
              {tab === "admin" && <Admin t={t} user={user} run={run} />}
            </>
          )}
        </div>
      </main>
      <nav className="mobile-nav">
        {tabs.map(([id, icon, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id);
              setSelected(null);
              setCreating(false);
            }}
          >
            <Icon name={icon} size={20} />
            <span>{t(label)}</span>
          </button>
        ))}
      </nav>
      {receive && (
        <Receive
          t={t}
          close={() => setReceive(false)}
          run={run}
          done={async (id: string) => {
            setReceive(false);
            await reload();
            await open(id);
          }}
        />
      )}
    </div>
  );
}
function Title({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty card">
      <span className="action-icon mint">
        <Icon name="box" size={30} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function RouteArt({ t }: Any) {
  return (
    <div className="route-art" aria-hidden="true">
      <svg viewBox="0 0 420 320">
        <defs>
          <pattern
            id="grid"
            width="38"
            height="38"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M38 0H0V38"
              fill="none"
              stroke="#ffffff"
              strokeOpacity=".08"
            />
          </pattern>
        </defs>
        <rect width="420" height="320" fill="url(#grid)" />
        <path
          d="M25 250 115 250 115 155 260 155 260 55 395 55M-10 110h425M180 0v320M350 0v320"
          stroke="#97c0ad"
          strokeWidth="18"
          strokeOpacity=".18"
          fill="none"
        />
        <path
          d="M93 237C210 237 112 80 320 80"
          fill="none"
          stroke="#eac783"
          strokeWidth="3"
          strokeDasharray="7 8"
        />
        <circle cx="93" cy="237" r="15" fill="#efc888" />
        <circle cx="93" cy="237" r="5" fill="#176e58" />
        <circle cx="320" cy="80" r="15" fill="#efc888" />
        <circle cx="320" cy="80" r="5" fill="#176e58" />
        <g transform="translate(148 97) rotate(-9 60 50)">
          <rect width="119" height="110" rx="19" fill="#efc888" />
          <path
            d="M0 30h119M47 0v30l14-7 14 7V0"
            stroke="#b38b4a"
            strokeWidth="2"
            fill="#f6dcae"
          />
          <path d="M21 80h32m-32 8h21" stroke="#a97d3b" strokeWidth="3" />
        </g>
        <rect x="228" y="211" width="164" height="53" rx="14" fill="#fff" />
        <circle cx="254" cy="238" r="13" fill="#e2f0e9" />
        <path
          d="m248 238 4 4 8-9"
          stroke="#176e58"
          strokeWidth="2"
          fill="none"
        />
        <text
          x="277"
          y="235"
          fontSize="12"
          fill="#254538"
          fontFamily="sans-serif"
        >
          {t("По пути — с заботой")}{" "}
        </text>
        <text
          x="277"
          y="251"
          fontSize="10"
          fill="#81918a"
          fontFamily="sans-serif"
        >
          {t("Узбекистан")}{" "}
        </text>
      </svg>
    </div>
  );
}
function OrderCard({
  o,
  t,
  click,
}: {
  o: Any;
  t: (s: string) => string;
  click: () => void;
}) {
  return (
    <button className="order-card card" onClick={click}>
      <div className="order-top">
        <span className={"status " + o.status}>
          {t(statusLabels[o.status] ?? o.status)}
        </span>
        <small>#{o.id.slice(0, 8)}</small>
      </div>
      <h3>{o.data.description}</h3>
      <div className="mini-route">
        <span className="route-dot" />
        <div>
          <b>{t(o.data.origin.city)}</b>
          <small>{o.data.origin.district}</small>
        </div>
        <span className="route-line" />
        <span className="route-dot end" />
        <div>
          <b>{t(o.data.destination.city)}</b>
          <small>{o.data.destination.district}</small>
        </div>
      </div>
      <div className="order-bottom">
        <span>
          {o.data.weight} {t("кг ·")}{" "}
          {t(o.data.fragile ? "Хрупкое" : "Стандарт")}
        </span>
        <b>{money(o.data.price.total)}</b>
      </div>
    </button>
  );
}
function Orders({
  orders,
  t,
  open,
  create,
  advanced,
  user,
}: {
  orders: Any[];
  t: (s: string) => string;
  open: (id: string) => void;
  create: () => void;
  advanced: () => void;
  user: Any;
}) {
  const [role, setRole] = useState("sender_id");
  const filtered = orders.filter((o) => o[role] === user.id);
  return (
    <>
      <Title
        title={t("Мои доставки")}
        subtitle={t("Все роли — в одном аккаунте")}
        action={
          <button className="button" onClick={create}>
            <Icon name="plus" size={18} />
            {t("Новая доставка")}
          </button>
        }
      />
      <button className="text-button" onClick={advanced}>
        {t("Подробное отправление · пункты и постаматы")}
      </button>
      <div className="segments">
        {[
          ["sender_id", "Отправляю"],
          ["courier_id", "Доставляю"],
          ["recipient_id", "Получаю"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={role === id ? "active" : ""}
            onClick={() => setRole(id)}
          >
            {t(label)}{" "}
            <small>{orders.filter((o) => o[id] === user.id).length}</small>
          </button>
        ))}
      </div>
      <div className="order-grid">
        {filtered.map((o) => (
          <OrderCard key={o.id} o={o} t={t} click={() => open(o.id)} />
        ))}
        {!filtered.length && (
          <Empty
            title={t("Пока нет заказов")}
            text={t("Новые доставки появятся здесь.")}
          />
        )}
      </div>
    </>
  );
}
function Login({ name, t, lang, setLang, done, authMode }: Any) {
  const [phone, setPhone] = useState(
      authMode === "demo" ? "+998900000000" : "+998",
    ),
    [userName, setName] = useState(authMode === "demo" ? "Азиза Демо" : ""),
    [dob, setDob] = useState("1995-03-15"),
    [code, setCode] = useState(""),
    [demo, setDemo] = useState(""),
    [sent, setSent] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!sent) {
        const r = await api("auth/otp", { phone, name: userName, dob });
        setDemo(r.code ?? "");
        setCode(r.code ?? "");
        setSent(true);
      } else {
        await api("auth/login", { phone, code });
        await done();
      }
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <section className="login-story">
        <a className="brand" href="/">
          <img src="/icon.svg" alt="" />
          {name}
          <span>•</span>
        </a>
        <div>
          <span className="pill light">{t("В пути — вместе")}</span>
          <h1>{t("Ваши посылки. Ваши маршруты.")}</h1>
          <p>{t("Помогайте друг другу по пути")}</p>
          <RouteArt t={t} />
        </div>
        <small>{t("Фергана · Коканд · Андижан · Наманган")}</small>
      </section>
      <section className="login-form">
        <button
          className="language"
          onClick={() => setLang(lang === "ru" ? "uz" : "ru")}
        >
          {lang === "ru" ? "O‘zbekcha" : "Русский"}
        </button>
        <div>
          <span className="eyebrow">
            {t(authMode === "demo" ? "Демо-режим" : "Вход по телефону")}
          </span>
          <h2>
            {lang === "ru"
              ? "Добро пожаловать в " + name
              : name + "ga xush kelibsiz"}
          </h2>
          <p>{t("Один аккаунт — отправляйте, доставляйте и получайте.")}</p>
          <form onSubmit={submit}>
            {!sent ? (
              <>
                <label>
                  {t("Имя")}
                  <input
                    required
                    value={userName}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  {t("Телефон")}
                  <input
                    type="tel"
                    required
                    pattern="\+998[0-9]{9}"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
                <label>
                  {t("Дата рождения")}
                  <input
                    type="date"
                    required
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                  />
                </label>
                {authMode === "demo" && (
                  <label>
                    {t("Демонстрационные аккаунты")}{" "}
                    <select
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        setName("Пользователь Демо");
                      }}
                    >
                      {[
                        "Азиза · отправитель",
                        "Бехруз · курьер",
                        "Дилноза · получатель",
                        "Сардор · курьер",
                        "Администратор",
                        "Оператор точки",
                        "Непроверенный пользователь",
                        "Поддержка",
                        "Финансовый сотрудник",
                      ].map((n, i) => (
                        <option key={n} value={"+99890000000" + i}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            ) : (
              <>
                <div className="info">
                  {demo ? (
                    <>
                      {t("Симуляция SMS. Демо-код:")} <b>{demo}</b>
                    </>
                  ) : (
                    t("Введите код из SMS")
                  )}
                </div>
                <label>
                  {t("Код подтверждения")}{" "}
                  <input
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
              </>
            )}
            {error && <div className="alert error">{error}</div>}
            <button className="button full" disabled={busy}>
              {busy ? t("Загрузка…") : t(sent ? "Войти" : "Получить код")}
              <Icon name="arrow" size={18} />
            </button>
            {sent && (
              <button
                type="button"
                className="text-button"
                onClick={() => setSent(false)}
              >
                {t("Назад")}
              </button>
            )}
          </form>
          <p className="fine">
            {t(
              "Подтверждение телефона не означает проверку личности. Все данные в демонстрационных аккаунтах вымышлены.",
            )}{" "}
          </p>
        </div>
      </section>
    </div>
  );
}
function Receive({ t, close, run, done }: Any) {
  const [invite, setInvite] = useState("");
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <button className="close" onClick={close}>
          ×
        </button>
        <h2>{t("Получить посылку")}</h2>
        <p>
          {t(
            "Вставьте секретный код из приглашения отправителя. Сначала подтвердите личность в профиле.",
          )}{" "}
        </p>
        <label>
          {t("Код приглашения")}
          <input value={invite} onChange={(e) => setInvite(e.target.value)} />
        </label>
        <button
          className="button"
          onClick={async () => {
            const r = await run(() => api("claim", { invite }));
            if (r) done(r.id);
          }}
        >
          {t("Привязать заказ")}
        </button>
      </section>
    </div>
  );
}
function Create({ t, user, settings, cancel, done, run }: Any) {
  const [step, setStep] = useState(0),
    [lockers, setLockers] = useState<Any[]>([]),
    [saving, setSaving] = useState(false);
  const city = String(user.profile.city ?? "Фергана");
  const coords = cities[city] ?? cities["Фергана"];
  const point = {
    kind: "person",
    city,
    district: "Центр",
    address: "",
    lat: coords[0],
    lng: coords[1],
    lockerId: "",
  };
  const [data, setData] = useState<Any>({
    origin: { ...point },
    destination: { ...point, lat: coords[0] + 0.01, lng: coords[1] + 0.02 },
    recipient: "+998900000002",
    category: "Документы",
    description: "",
    weight: 1,
    dimensions: [20, 15, 10],
    declaredValue: 100000,
    fragile: false,
    pickupAt: new Date(Date.now() + 3600000).toISOString(),
    deliverBy: new Date(Date.now() + 10800000).toISOString(),
    instruction: "",
    payer: "sender",
    allowedContents: false,
    packaging: false,
    urgent: false,
    photos: [],
  });
  useEffect(() => {
    api("lockers")
      .then(setLockers)
      .catch(() => {});
  }, []);
  const set = (key: string, value: any) =>
    setData((old: Any) => ({ ...old, [key]: value }));
  const updatePoint = (endpoint: string, key: string, value: any) =>
    setData((old: Any) => ({
      ...old,
      [endpoint]: {
        ...old[endpoint],
        [key]: value,
        ...(key === "city"
          ? { lat: cities[value][0], lng: cities[value][1], lockerId: "" }
          : {}),
      },
    }));
  const estimateKm = (() => {
    const a = data.origin,
      b = data.destination,
      r = Math.PI / 180,
      x =
        Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
        Math.cos(a.lat * r) *
          Math.cos(b.lat * r) *
          Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
    return (
      Math.round(6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)) * 10) /
      10
    );
  })();
  const delivery = Math.round(
      (settings.base +
        estimateKm * settings.perKm +
        data.weight * settings.perKg) *
        (data.urgent ? 1.25 : 1),
    ),
    fee = Math.round(delivery * settings.commission);
  const titles = [
    "Маршрут",
    "Детали посылки",
    "Условия и оплата",
    "Проверить заказ",
  ];
  const localDate = (v: string) => {
    const d = new Date(v);
    return new Date(d.getTime() + 5 * 3600000).toISOString().slice(0, 16);
  };
  return (
    <>
      <button className="text-button" onClick={cancel}>
        ← {t("Назад")}
      </button>
      <Title
        title={t("Отправить посылку")}
        subtitle={t("Одна посылка, один попутчик, безопасная передача")}
      />
      <div className="wizard-steps">
        {titles.map((s, i) => (
          <button
            key={s}
            className={i === step ? "active" : i < step ? "passed" : ""}
            disabled={i > step}
            onClick={() => setStep(i)}
          >
            <span>{i < step ? "✓" : i + 1}</span>
            {t(s)}
          </button>
        ))}
      </div>
      <form
        className="card form-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (step < 3) {
            setStep(step + 1);
            return;
          }
          setSaving(true);
          const r = await run(() => api("shipments", data), "Черновик создан");
          setSaving(false);
          if (r) done(r.id, r.invite);
        }}
      >
        <h2>{t(titles[step])}</h2>
        {step === 0 && (
          <>
            <div className="form-grid">
              {["origin", "destination"].map((endpoint, i) => (
                <section key={endpoint}>
                  <h3>
                    <span className="number-badge">{i + 1}</span>{" "}
                    {t(i === 0 ? "Откуда забрать" : "Куда доставить")}
                  </h3>
                  <label>
                    {t("Тип точки")}{" "}
                    <select
                      value={data[endpoint].kind}
                      onChange={(e) =>
                        updatePoint(endpoint, "kind", e.target.value)
                      }
                    >
                      {[
                        ["person", "Человек"],
                        ["point", "Пункт выдачи"],
                        ["locker", "Постамат"],
                      ].map(([k, l]) => (
                        <option key={k} value={k}>
                          {t(l)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("Город")}
                    <select
                      value={data[endpoint].city}
                      onChange={(e) =>
                        updatePoint(endpoint, "city", e.target.value)
                      }
                    >
                      {Object.keys(cities).map((c) => (
                        <option key={c} value={c}>
                          {t(c)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("Район")}
                    <input
                      required
                      value={data[endpoint].district}
                      onChange={(e) =>
                        updatePoint(endpoint, "district", e.target.value)
                      }
                    />
                  </label>
                  {data[endpoint].kind !== "person" && (
                    <label>
                      {t("Демонстрационная точка")}{" "}
                      <select
                        required
                        value={data[endpoint].lockerId}
                        onChange={(e) => {
                          const l = lockers.find(
                            (x) => x.id === e.target.value,
                          );
                          setData((old: Any) => ({
                            ...old,
                            [endpoint]: {
                              ...old[endpoint],
                              lockerId: e.target.value,
                              address: l?.name ?? "",
                            },
                          }));
                        }}
                      >
                        <option value="">{t("Выберите точку")}</option>
                        {lockers
                          .filter(
                            (l) =>
                              l.city === data[endpoint].city &&
                              l.kind === data[endpoint].kind,
                          )
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <label>
                    {t("Адрес")}
                    <input
                      required
                      minLength={3}
                      value={data[endpoint].address}
                      onChange={(e) =>
                        updatePoint(endpoint, "address", e.target.value)
                      }
                      placeholder={t("Улица, дом, квартира")}
                    />
                  </label>
                  <div className="two-fields">
                    <label>
                      {t("Широта")}{" "}
                      <input
                        type="number"
                        step=".0001"
                        min="39"
                        max="42"
                        value={data[endpoint].lat}
                        onChange={(e) =>
                          updatePoint(endpoint, "lat", Number(e.target.value))
                        }
                      />
                    </label>
                    <label>
                      {t("Долгота")}{" "}
                      <input
                        type="number"
                        step=".0001"
                        min="69"
                        max="74"
                        value={data[endpoint].lng}
                        onChange={(e) =>
                          updatePoint(endpoint, "lng", Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                </section>
              ))}
            </div>
            <div className="info">
              {t(
                "MVP: доставка внутри одного города. Междугородние маршруты — следующий этап.",
              )}{" "}
            </div>
          </>
        )}
        {step === 1 && (
          <div className="form-grid">
            <div>
              <label>
                {t("Категория")}
                <select
                  value={data.category}
                  onChange={(e) => set("category", e.target.value)}
                >
                  {["Документы", "Одежда", "Книги", "Электроника", "Другое"]
                    .filter((c) => !settings.banned.includes(c))
                    .map((c) => (
                      <option key={c} value={c}>
                        {t(c)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t("Описание")}
                <textarea
                  required
                  minLength={3}
                  maxLength={1000}
                  value={data.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder={t("Что отправляете и как упаковано?")}
                />
              </label>
              <label>
                {t("Вес, кг")}
                <input
                  required
                  type="number"
                  step=".1"
                  min=".1"
                  max={settings.maxWeight}
                  value={data.weight}
                  onChange={(e) => set("weight", Number(e.target.value))}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={data.fragile}
                  onChange={(e) => set("fragile", e.target.checked)}
                />
                {t("Хрупкое")}
              </label>
            </div>
            <div>
              <label>
                {t("Размеры, см (длина × ширина × высота)")}{" "}
                <div className="dimension-fields">
                  {data.dimensions.map((v: number, i: number) => (
                    <input
                      key={i}
                      aria-label={["Длина", "Ширина", "Высота"][i]}
                      type="number"
                      required
                      min="1"
                      max={settings.maxDimension}
                      value={v}
                      onChange={(e) =>
                        set(
                          "dimensions",
                          data.dimensions.map((n: number, j: number) =>
                            i === j ? Number(e.target.value) : n,
                          ),
                        )
                      }
                    />
                  ))}
                </div>
              </label>
              <label>
                {t("Заявленная стоимость")}
                <input
                  type="number"
                  required
                  min="0"
                  max={settings.maxDeclared}
                  value={data.declaredValue}
                  onChange={(e) => set("declaredValue", Number(e.target.value))}
                />
              </label>
              <p className="fine">
                {t("Заявленная стоимость не является страхованием.")}{" "}
              </p>
              <label>
                {t("Фото упаковки (до 6, JPEG/PNG/WebP, 5 МБ)")}{" "}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={data.photos.length >= 6}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const fd = new FormData();
                    fd.append("file", f);
                    const r = await run(
                      () => api("files", fd),
                      "Фото загружено",
                    );
                    if (r) set("photos", [...data.photos, r.id]);
                  }}
                />
              </label>
              <div className="photos">
                {data.photos.map((p: string) => (
                  <img key={p} src={"/api/files/" + p} alt={t("Упаковка")} />
                ))}
              </div>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="form-grid">
            <div>
              <label>
                {t("Получатель")} {t("(телефон или публичный ID)")}{" "}
                <input
                  required
                  value={data.recipient}
                  onChange={(e) => set("recipient", e.target.value)}
                  placeholder={t("+998… или YD-…")}
                />
              </label>
              <p className="fine">
                {t(
                  "Если аккаунта еще нет, после создания черновика отправьте секретное приглашение получателю. Перед выдачей нужна проверка личности.",
                )}{" "}
              </p>
              <label>
                {t("Кто оплачивает")}
                <select
                  value={data.payer}
                  onChange={(e) => set("payer", e.target.value)}
                >
                  <option value="sender">{t("Отправитель")}</option>
                  <option value="recipient">{t("Получатель")}</option>
                </select>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={data.urgent}
                  onChange={(e) => set("urgent", e.target.checked)}
                />
                {t("Срочно")} (+25%)
              </label>
            </div>
            <div>
              <label>
                {t("Забор")} · Asia/Tashkent
                <input
                  type="datetime-local"
                  required
                  value={localDate(data.pickupAt)}
                  onChange={(e) => {
                    if (e.target.value)
                      set(
                        "pickupAt",
                        new Date(e.target.value + ":00+05:00").toISOString(),
                      );
                  }}
                />
              </label>
              <label>
                {t("Доставить до")} · Asia/Tashkent
                <input
                  type="datetime-local"
                  required
                  value={localDate(data.deliverBy)}
                  onChange={(e) => {
                    if (e.target.value)
                      set(
                        "deliverBy",
                        new Date(e.target.value + ":00+05:00").toISOString(),
                      );
                  }}
                />
              </label>
              <label>
                {t("Инструкция к входу и передаче")}{" "}
                <textarea
                  maxLength={500}
                  value={data.instruction}
                  onChange={(e) => set("instruction", e.target.value)}
                />
              </label>
            </div>
          </div>
        )}
        {step === 3 && (
          <>
            <div className="summary-route">
              <Icon name="route" size={32} />
              <div>
                <h3>
                  {data.origin.city} · {data.origin.district} →{" "}
                  {data.destination.district}
                </h3>
                <p>
                  {data.description} · {data.weight} {t("кг ·")}{" "}
                  {data.dimensions.join(" × ")} {t("см")}{" "}
                </p>
                <p>
                  {t("Доставить до")}: {time(data.deliverBy)}
                </p>
              </div>
            </div>
            <div className="price-summary">
              <span>
                {t("Доставка")} <b>{money(delivery)}</b>
              </span>
              <span>
                {t("Комиссия")} <b>{money(fee)}</b>
              </span>
              <span>
                {t("Дополнительные услуги")} <b>{t("0 сум")}</b>
              </span>
              <span className="total">
                {t("Итого")} <b>{money(delivery + fee)}</b>
              </span>
              <span>
                {t("Доход курьера")} <b>{money(delivery)}</b>
              </span>
            </div>
            <p className="fine">
              {t("Приблизительная оценка по прямой, не дорожный маршрут")}:{" "}
              {estimateKm} {t("км. Тариф зафиксируется на сервере.")}{" "}
            </p>
            <label className="check-label">
              <input
                required
                type="checkbox"
                checked={data.allowedContents}
                onChange={(e) => set("allowedContents", e.target.checked)}
              />
              {t("Подтверждаю допустимость содержимого. Запрещено:")}{" "}
              {settings.banned.join(", ")}.
            </label>
            <label className="check-label">
              <input
                required
                type="checkbox"
                checked={data.packaging}
                onChange={(e) => set("packaging", e.target.checked)}
              />
              {t(
                "Посылка закрыта и упакована, хрупкое защищено, содержимое соответствует описанию.",
              )}{" "}
            </label>
            {user.identity !== "verified" && (
              <div className="info">
                {t(
                  "Создать черновик можно сейчас. Для публикации пройдите проверку личности в профиле.",
                )}{" "}
              </div>
            )}
          </>
        )}
        <div className="form-footer">
          {step > 0 && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setStep(step - 1)}
            >
              {t("Назад")}
            </button>
          )}
          <button className="button" disabled={saving}>
            {saving
              ? t("Загрузка…")
              : t(step === 3 ? "Создать черновик" : "Далее")}
            <Icon name="arrow" size={18} />
          </button>
        </div>
      </form>
    </>
  );
}
function Nearby({ t, user, run, goProfile }: Any) {
  const [city, setCity] = useState(user.profile.city ?? "Фергана"),
    [list, setList] = useState<Any[]>([]),
    [couriers, setCouriers] = useState<Any[]>([]),
    [view, setView] = useState("orders"),
    [loaded, setLoaded] = useState(false),
    [offered, setOffered] = useState<string[]>([]),
    [coords, setCoords] = useState<number[]>(cities[city]),
    [destination, setDestination] = useState([
      cities[city][0] + 0.03,
      cities[city][1] + 0.03,
    ]),
    [departAt, setDepartAt] = useState(
      new Date(Date.now() + 6 * 3600000).toISOString().slice(0, 16),
    );
  async function load() {
    const r = await run(async () => {
      await api("route", {
        origin: coords,
        destination,
        city,
        departAt: new Date(departAt + ":00+05:00").toISOString(),
      });
      return api(
        `nearby?city=${encodeURIComponent(city)}&lat=${coords[0]}&lng=${coords[1]}&destLat=${destination[0]}&destLng=${destination[1]}`,
      );
    }, "");
    if (r) {
      setList(r);
      setLoaded(true);
    }
  }
  useEffect(() => {
    api("couriers")
      .then(setCouriers)
      .catch(() => {});
  }, []);
  return (
    <>
      <Title
        title={t("Доставить по пути")}
        subtitle={t(
          "Укажите поездку — найдите посылку рядом с вашим маршрутом",
        )}
      />
      <div className="segments">
        <button
          className={view === "orders" ? "active" : ""}
          onClick={() => setView("orders")}
        >
          {t("Заказы рядом")}
        </button>
        <button
          className={view === "couriers" ? "active" : ""}
          onClick={() => setView("couriers")}
        >
          {t("Курьеры")}{" "}
        </button>
      </div>
      {view === "orders" ? (
        <>
          <div className="card route-search">
            <div className="form-grid">
              <label>
                {t("Город")}
                <select
                  value={city}
                  onChange={(e) => {
                    setCity(e.target.value);
                    setCoords(cities[e.target.value]);
                    setDestination([
                      cities[e.target.value][0] + 0.03,
                      cities[e.target.value][1] + 0.03,
                    ]);
                  }}
                >
                  {Object.keys(cities).map((c) => (
                    <option key={c} value={c}>
                      {t(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Время поездки · Asia/Tashkent")}{" "}
                <input
                  type="datetime-local"
                  value={departAt}
                  onChange={(e) => setDepartAt(e.target.value)}
                />
              </label>
              <label>
                {t("Откуда (широта, долгота)")}{" "}
                <div className="two-fields">
                  {coords.map((v: number, i: number) => (
                    <input
                      key={i}
                      type="number"
                      step=".0001"
                      value={v}
                      onChange={(e) =>
                        setCoords(
                          coords.map((n: number, j: number) =>
                            i === j ? Number(e.target.value) : n,
                          ),
                        )
                      }
                    />
                  ))}
                </div>
              </label>
              <label>
                {t("Куда (широта, долгота)")}{" "}
                <div className="two-fields">
                  {destination.map((v: number, i: number) => (
                    <input
                      key={i}
                      type="number"
                      step=".0001"
                      value={v}
                      onChange={(e) =>
                        setDestination(
                          destination.map((n: number, j: number) =>
                            i === j ? Number(e.target.value) : n,
                          ),
                        )
                      }
                    />
                  ))}
                </div>
              </label>
            </div>
            <div className="row">
              <button className="button" onClick={load}>
                {t("Найти заказы")}
                <Icon name="arrow" size={18} />
              </button>
              <button
                className="text-button"
                onClick={() => {
                  if (!navigator.geolocation) return;
                  navigator.geolocation.getCurrentPosition(
                    (p) => setCoords([p.coords.latitude, p.coords.longitude]),
                    () =>
                      run(async () => {
                        throw new Error(
                          "Геолокация недоступна. Введите координаты вручную",
                        );
                      }),
                  );
                }}
              >
                {t("Мое положение")}{" "}
              </button>
            </div>
            <p className="fine">
              {t("Приблизительная оценка по прямой, не дорожный маршрут")}
              {t(". Точные адреса доступны после назначения.")}{" "}
            </p>
          </div>
          {user.identity !== "verified" && (
            <div className="info">
              {t("Для принятия доставки нужна проверка личности.")}{" "}
              <button className="text-button" onClick={goProfile}>
                {t("Профиль")} →
              </button>
            </div>
          )}
          <div className="section-heading">
            <h2>{t("Доставки в вашем городе")}</h2>
            <small>
              {list.length} {t("заказов")}
            </small>
          </div>
          <div className="order-grid">
            {list.map((o) => (
              <div className="card nearby-card" key={o.id}>
                <div className="row">
                  <span className="pill">
                    {o.weight} {t("кг ·")} {o.category}
                  </span>
                  <b>{money(o.price.courier)}</b>
                </div>
                <h3>{o.description}</h3>
                <p>
                  {o.origin.district} → {o.destination.district}
                </p>
                <div className="route-metrics">
                  <span>
                    {t("До забора")}{" "}
                    <b>
                      ~{o.proximity.toFixed(1)} {t("км")}
                    </b>
                  </span>
                  <span>
                    {t("Доп. путь")}{" "}
                    <b>
                      ~{o.detour.toFixed(1)} {t("км")}
                    </b>
                  </span>
                  <span>
                    {t("Доп. время")}{" "}
                    <b>
                      ~{o.additionalMinutes} {t("мин")}
                    </b>
                  </span>
                </div>
                <p className="fine">
                  {t("Доставить до")}: {time(o.deliverBy)}{" "}
                  {t("· приближенно")}{" "}
                </p>
                <button
                  className="button full"
                  disabled={offered.includes(o.id)}
                  onClick={async () => {
                    const r = await run(
                      () => api("shipments/" + o.id + "/offer", {}),
                      "Отклик отправлен. Ожидайте выбора отправителя.",
                    );
                    if (r) setOffered([...offered, o.id]);
                  }}
                >
                  {offered.includes(o.id)
                    ? "Отклик отправлен"
                    : t("Откликнуться")}
                </button>
              </div>
            ))}
            {!list.length && (
              <Empty
                title={
                  loaded
                    ? "Подходящих заказов пока нет"
                    : "Сначала укажите маршрут"
                }
                text={t("Попробуйте другой район или время поездки.")}
              />
            )}
          </div>
        </>
      ) : (
        <div className="order-grid">
          {couriers.map((c) => (
            <div key={c.id} className="card courier-card">
              <span className="avatar">{c.name[0]}</span>
              <h3>{c.name}</h3>
              <p>
                {c.public_id} · {c.profile.city}
              </p>
              <p>
                {c.deliveries} {t("доставок ·")}{" "}
                {c.rating ? `★ ${c.rating}` : "Пока без рейтинга"}
              </p>
              <span className="pill">
                {c.profile.transport === "car"
                  ? t("Автомобиль")
                  : c.profile.transport === "bike"
                    ? t("Велосипед")
                    : t("Пешком")}
              </span>
              <p className="fine">
                {t(
                  "Курьер назначается из откликов в вашем опубликованном заказе.",
                )}{" "}
              </p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
function Detail({ t, user, initial: s, setSelected, act, busy, back }: Any) {
  const [message, setMessage] = useState(""),
    [code, setCode] = useState(""),
    [issued, setIssued] = useState<Any | null>(null),
    [connected, setConnected] = useState(true),
    [reason, setReason] = useState(""),
    [stars, setStars] = useState(5),
    [comment, setComment] = useState(""),
    [evidence, setEvidence] = useState<string[]>([]);
  useEffect(() => {
    const events = new EventSource("/api/events?shipmentId=" + s.id);
    events.onmessage = (e) => {
      setSelected(JSON.parse(e.data));
      setConnected(true);
    };
    events.onerror = () => setConnected(false);
    return () => events.close();
  }, [s.id, setSelected]);
  useEffect(() => {
    setIssued(null);
    setCode("");
  }, [s.status]);
  const sender = s.sender_id === user.id,
    courier = s.courier_id === user.id,
    recipient = s.recipient_id === user.id;
  const participantName = (id: string | null) =>
    s.participants.find((p: Any) => p.id === id)?.name ?? "Точка выдачи";
  const pickup = s.data.origin.kind,
    delivery = s.data.destination.kind;
  const stage =
    s.status === "pickup_arrived"
      ? "pickup"
      : s.status === "returning"
        ? "return"
        : "delivery";
  const early = [
    "draft",
    "awaiting_payment",
    "published",
    "assigned",
    "pickup_arrived",
  ].includes(s.status);
  const active = !["completed", "returned", "cancelled"].includes(s.status);
  const button = (label: string, action: string, body: Any = {}) => (
    <button
      key={action}
      className="button"
      disabled={busy}
      onClick={() => act(action, body)}
    >
      {t(label)}
    </button>
  );
  async function photoUpload(file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("shipmentId", s.id);
    const r = await api("files", form);
    setEvidence([...evidence, r.id]);
    return r.id;
  }
  return (
    <>
      <button className="text-button" onClick={back}>
        ← {t("Мои доставки")}
      </button>
      <Title
        title={s.data.description}
        subtitle={"#" + s.id.slice(0, 8) + " · " + time(s.created_at)}
        action={
          <span className={"status " + s.status}>
            {t(statusLabels[s.status])}
          </span>
        }
      />
      {!connected && (
        <div className="info">
          {t("Соединение потеряно · последнее состояние")} ·{" "}
          {time(s.updated_at)}
        </div>
      )}
      <div className="detail-grid">
        <div>
          <section className="card detail-card">
            <div className="section-heading">
              <h2>{t("Маршрут")}</h2>
              <span className="pill">
                {s.data.weight} {t("кг")}
              </span>
            </div>
            <div className="address-route">
              {["origin", "destination"].map((p, i) => (
                <div key={p}>
                  <span className={"route-dot " + (i ? "end" : "")} />
                  <div>
                    <small>{i ? t("Получатель") : t("Забор")}</small>
                    <h3>
                      {t(s.data[p].city)} · {s.data[p].district}
                    </h3>
                    <p>{s.data[p].address}</p>
                    <small>
                      {t(
                        (
                          {
                            person: "Человек",
                            point: "Пункт выдачи",
                            locker: "Постамат",
                          } as Any
                        )[s.data[p].kind],
                      )}
                    </small>
                  </div>
                </div>
              ))}
            </div>
            <RouteMap s={s} t={t} />
            <p className="fine">
              {t("Схема координат · дорожный маршрутизатор не подключен.")}{" "}
              {s.data.lastLocation && active
                ? "Последнее положение: " + time(s.data.lastLocation.at)
                : "Живое положение не передается."}
            </p>
            <div className="facts">
              <div>
                <small>{t("Ответственный")}</small>
                <b>{t(participantName(s.custodian_id))}</b>
              </div>
              <div>
                <small>{t("Где посылка")}</small>
                <b>{t(s.location)}</b>
              </div>
              <div>
                <small>{t("Доставить до")}</small>
                <b>{time(s.data.deliverBy)}</b>
              </div>
              <div>
                <small>{t("Участники")}</small>
                <b>{s.participants.map((p: Any) => p.name).join(" · ")}</b>
              </div>
            </div>
            {s.data.instruction && (
              <div className="info">{s.data.instruction}</div>
            )}
            <div className="photos">
              {s.data.photos.map((p: string) => (
                <a key={p} href={"/api/files/" + p} target="_blank">
                  <img src={"/api/files/" + p} alt={t("Фото упаковки")} />
                </a>
              ))}
            </div>
          </section>
          <section className="card detail-card">
            <h2>{t("Следующий шаг")}</h2>
            {sender && !s.recipient_id && (
              <button
                className="button secondary"
                onClick={async () => {
                  const r = await act("invite");
                  if (r)
                    prompt(
                      "Секретное приглашение: передайте только получателю",
                      r.invite,
                    );
                }}
              >
                {t("Получить приглашение")}{" "}
              </button>
            )}
            <div className="action-buttons">
              {sender &&
                ["draft", "awaiting_payment"].includes(s.status) &&
                button("Опубликовать", "publish")}
              {recipient &&
                s.data.payer === "recipient" &&
                !s.recipient_consent &&
                button("Согласен оплатить", "consent")}
              {user.id ===
                (s.data.payer === "sender" ? s.sender_id : s.recipient_id) &&
                s.payment_status === "unpaid" &&
                button("Оплатить (демо)", "pay")}
              {courier &&
                s.status === "assigned" &&
                button("Прибыл на забор", "arrive")}
              {courier &&
                s.status === "picked_up" &&
                button("Посылка в пути", "transit")}
              {courier &&
                s.status === "in_transit" &&
                button("Прибыл в точку назначения", "destination")}
              {courier &&
                s.status === "destination_arrived" &&
                delivery === "person" &&
                button("Передать получателю", "ready")}
              {recipient &&
                s.status === "received" &&
                button("Подтвердить получение", "complete")}
              {courier &&
                s.status === "return_agreed" &&
                button("Начать возврат", "returning")}
              {((sender &&
                s.status === "pickup_arrived" &&
                pickup === "person") ||
                (recipient &&
                  s.status === "awaiting_receipt" &&
                  delivery === "person") ||
                (sender && s.status === "returning")) && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={async () => {
                    const r = await act("code", { stage });
                    if (r) setIssued({ ...r, at: Date.now() });
                  }}
                >
                  {t(
                    stage === "pickup"
                      ? "Передать посылку"
                      : stage === "return"
                        ? "Код возврата"
                        : "Код получателя",
                  )}
                </button>
              )}
            </div>
            {issued && (
              <div className="handover-code">
                <small>
                  {t("Код действует 5 минут")} ·{" "}
                  {time(new Date(issued.at + 300000).toISOString())}
                </small>
                <strong>{issued.code}</strong>
                <p>
                  {t(
                    "Сообщите код только назначенному курьеру после проверки посылки. Это секретный код подтверждения передачи.",
                  )}{" "}
                </p>
              </div>
            )}
            {courier &&
              ((s.status === "pickup_arrived" && pickup === "person") ||
                (s.status === "awaiting_receipt" && delivery === "person") ||
                s.status === "returning") && (
                <form
                  className="code-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act("handover", { stage, code });
                  }}
                >
                  <label>
                    {t("Одноразовый код")}{" "}
                    {stage === "pickup"
                      ? "отправителя"
                      : stage === "return"
                        ? "возврата"
                        : "получателя"}
                    <input
                      required
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="000000"
                    />
                  </label>
                  <button className="button" disabled={busy}>
                    {t(
                      stage === "pickup"
                        ? "Принять посылку"
                        : "Подтвердить передачу",
                    )}
                  </button>
                </form>
              )}
            {((sender && pickup !== "person" && early) ||
              (courier &&
                s.status === "pickup_arrived" &&
                pickup !== "person") ||
              (courier &&
                s.status === "destination_arrived" &&
                delivery !== "person") ||
              (recipient &&
                s.status === "awaiting_receipt" &&
                delivery !== "person")) && (
              <div className="simulator">
                <span className="pill">
                  {t("Симулятор")}{" "}
                  {pickup === "point" || delivery === "point"
                    ? "пункта"
                    : "постамата"}
                </span>
                <p>
                  {t(
                    "Наличие и изъятие посылки — отдельные подтвержденные события. Открытие двери не завершает доставку.",
                  )}{" "}
                </p>
                <div className="action-buttons">
                  {(sender ||
                    (courier && s.status === "destination_arrived")) && (
                    <>
                      {button("Резервировать ячейку", "locker", {
                        operation: "reserve",
                        endpoint: sender ? "origin" : "destination",
                        eventId: crypto.randomUUID(),
                      })}
                      {button("Подтвердить помещение", "locker", {
                        operation: "deposit",
                        endpoint: sender ? "origin" : "destination",
                        eventId: crypto.randomUUID(),
                      })}
                    </>
                  )}
                  {((courier && s.status === "pickup_arrived") || recipient) &&
                    button("Подтвердить изъятие", "locker", {
                      operation: "collect",
                      endpoint: courier ? "origin" : "destination",
                      eventId: crypto.randomUUID(),
                    })}
                </div>
              </div>
            )}
            {sender &&
              early &&
              pickup !== "person" &&
              s.reservations.some(
                (r: Any) => r.stage === "origin" && r.status === "deposited",
              ) &&
              button("Забрать обратно до забора курьером", "locker", {
                operation: "reclaim",
                endpoint: "origin",
                eventId: crypto.randomUUID(),
              })}
            {s.reservations.map((r: Any) => (
              <div className="info" key={r.id}>
                {r.name}: {t(r.status)} {t("· срок")} {time(r.expires_at)} ·{" "}
                {r.connected ? "в сети" : "нет связи"}
              </div>
            ))}
            {sender && s.status === "published" && (
              <>
                <h3>{t("Выбрать курьера")}</h3>
                {s.offers.map((o: Any) => (
                  <div className="offer" key={o.user_id}>
                    <div>
                      <b>{o.name}</b>
                      <p>
                        {o.deliveries} {t("доставок ·")}{" "}
                        {o.rating ? `★ ${o.rating}` : "Нет оценок"} ·{" "}
                        {o.profile.transport}
                      </p>
                    </div>
                    {button("Выбрать курьера", "assign", {
                      courierId: o.user_id,
                    })}
                  </div>
                ))}
                {!s.offers.length && (
                  <p className="muted">
                    {t(
                      "Ожидаем отклики. Курьер найдет заказ в разделе «Заказы рядом».",
                    )}{" "}
                  </p>
                )}
              </>
            )}
            {active && courier && !early && (
              <button
                className="text-button"
                onClick={() =>
                  navigator.geolocation?.getCurrentPosition(
                    (p) =>
                      act("location", {
                        lat: p.coords.latitude,
                        lng: p.coords.longitude,
                        consent: true,
                      }),
                    () =>
                      alert(
                        "Доступ к геолокации отклонен. Доставка продолжается без отслеживания.",
                      ),
                  )
                }
              >
                {t("Согласен передать текущее положение")}{" "}
              </button>
            )}
            {sender && early && button("Отменить заказ", "cancel")}
            {courier &&
              ["assigned", "pickup_arrived"].includes(s.status) &&
              button("Отказаться до забора", "decline")}
            {sender &&
              !early &&
              [
                "picked_up",
                "in_transit",
                "destination_arrived",
                "awaiting_receipt",
                "delivery_failed",
              ].includes(s.status) &&
              button("Согласовать возврат", "return")}
            {s.status === "completed" && (
              <p className="success-text">
                {t(
                  "✓ Доставка завершена подтверждением получателя. Теперь можно оставить отзыв.",
                )}{" "}
              </p>
            )}
          </section>
          <section className="card detail-card">
            <h2>{t("Чат заказа")}</h2>
            <div className="messages">
              {s.messages.map((m: Any) => (
                <div
                  key={m.id}
                  className={"message " + (m.user_id === user.id ? "own" : "")}
                >
                  <small>
                    {m.name} · {time(m.created_at)}
                  </small>
                  <p>{m.text}</p>
                  {m.photo_id && (
                    <img
                      src={"/api/files/" + m.photo_id}
                      alt={t("Фото в чате")}
                    />
                  )}
                  <button
                    className="report-button"
                    onClick={() => {
                      const r = prompt(t("Причина жалобы"));
                      if (r)
                        act("report", { messageId: Number(m.id), reason: r });
                    }}
                  >
                    {t("Пожаловаться")}{" "}
                  </button>
                </div>
              ))}
              {!s.messages.length && (
                <p className="muted">
                  {t(
                    "Уточните детали передачи. Не отправляйте паспортные данные.",
                  )}{" "}
                </p>
              )}
            </div>
            <form
              className="chat-input"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await act("message", { text: message });
                if (r) setMessage("");
              }}
            >
              <input
                aria-label={t("Текст сообщения")}
                required
                maxLength={2000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t("Напишите сообщение…")}
              />
              <button
                className="button"
                disabled={busy}
                aria-label={t("Отправить")}
              >
                <Icon name="arrow" size={20} />
              </button>
            </form>
            <label className="fine">
              {t("Прикрепить фото")}{" "}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const id = await photoUpload(f);
                    await act("message", { text: "", photoId: id });
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }}
              />
            </label>
          </section>
          {["completed", "returned"].includes(s.status) && (
            <section className="card detail-card">
              <h2>{t("Оставить отзыв")}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const targetId = courier ? s.sender_id : s.courier_id;
                  act("review", {
                    targetId,
                    role: courier ? "sender" : "courier",
                    stars,
                    comment,
                    reason: "communication",
                  });
                }}
              >
                <label>
                  {t("Оценка")}{" "}
                  <select
                    value={stars}
                    onChange={(e) => setStars(Number(e.target.value))}
                  >
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {"★".repeat(n)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Комментарий")}
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={1000}
                  />
                </label>
                <button className="button" disabled={busy}>
                  {t("Оставить отзыв")}
                </button>
              </form>
              <p className="fine">
                {t(
                  "Встречные отзывы публикуются после ответа обеих сторон или через 7 дней.",
                )}{" "}
              </p>
            </section>
          )}
        </div>
        <aside className="detail-aside">
          <section className="card detail-card">
            <h2>{t("Условия и оплата")}</h2>
            <div className="price-summary">
              <span>
                {t("Доставка")}
                <b>{money(s.data.price.delivery)}</b>
              </span>
              <span>
                {t("Комиссия")}
                <b>{money(s.data.price.fee)}</b>
              </span>
              <span className="total">
                {t("Итого")}
                <b>{money(s.data.price.total)}</b>
              </span>
            </div>
            <p>
              {t("Статус оплаты")}: <b>{t(s.payment_status)}</b>
            </p>
            <p>
              {t("Выплата:")} <b>{t(s.payout_status)}</b>
            </p>
            <small className="muted">
              {t(
                "Все платежи демонстрационные. Страхование не подключено.",
              )}{" "}
            </small>
          </section>
          <section className="card detail-card">
            <h2>{t("История доставки")}</h2>
            <div className="timeline">
              {s.events.map((e: Any, i: number) => (
                <div
                  key={e.id}
                  className={i === s.events.length - 1 ? "current" : ""}
                >
                  <span />
                  <div>
                    <b>{t(e.detail)}</b>
                    <small>{time(e.created_at)}</small>
                  </div>
                </div>
              ))}
            </div>
          </section>
          {!["draft", "awaiting_payment", "published", "cancelled"].includes(
            s.status,
          ) && (
            <section className="card detail-card">
              <h2>{t("Помощь и спор")}</h2>
              <p>
                {t(
                  "Местонахождение и ответственность сохраняются при открытии спора.",
                )}{" "}
              </p>
              {s.disputes.map((d: Any) => (
                <div className="info" key={d.id}>
                  <b>{t(d.status)}</b>
                  <p>{d.reason}</p>
                  {d.resolution && <p>{d.resolution}</p>}
                </div>
              ))}
              <label>
                {t("Причина / комментарий")}{" "}
                <textarea
                  minLength={3}
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("Что произошло?")}
                />
              </label>
              <label>
                {t("Доказательства")}{" "}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (e) => {
                    if (e.target.files?.[0])
                      try {
                        await photoUpload(e.target.files[0]);
                      } catch (e) {
                        alert((e as Error).message);
                      }
                  }}
                />
              </label>
              <div className="photos">
                {evidence.map((p) => (
                  <img
                    key={p}
                    src={"/api/files/" + p}
                    alt={t("Доказательство")}
                  />
                ))}
              </div>
              <button
                className="button secondary full"
                disabled={
                  busy || reason.length < 3 || s.dispute_status === "open"
                }
                onClick={() => act("dispute", { reason, evidence })}
              >
                {t("Открыть спор")}
              </button>
              {courier &&
                [
                  "in_transit",
                  "destination_arrived",
                  "awaiting_receipt",
                ].includes(s.status) && (
                  <button
                    className="text-button"
                    disabled={reason.length < 3}
                    onClick={() => act("failure", { reason })}
                  >
                    {t("Зафиксировать неудачную доставку")}{" "}
                  </button>
                )}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
function RouteMap({ s, t }: Any) {
  const points = [
    s.data.origin,
    s.data.destination,
    ...(s.data.lastLocation ? [s.data.lastLocation] : []),
  ];
  const minLat = Math.min(...points.map((p) => p.lat)) - 0.005,
    maxLat = Math.max(...points.map((p) => p.lat)) + 0.005,
    minLng = Math.min(...points.map((p) => p.lng)) - 0.005,
    maxLng = Math.max(...points.map((p) => p.lng)) + 0.005;
  const xy = (p: Any) => [
    40 + ((p.lng - minLng) / (maxLng - minLng)) * 360,
    160 - ((p.lat - minLat) / (maxLat - minLat)) * 120,
  ];
  const a = xy(points[0]),
    b = xy(points[1]);
  return (
    <div className="map">
      <svg
        viewBox="0 0 440 200"
        role="img"
        aria-label={t("Приблизительная схема координат")}
      >
        <defs>
          <pattern
            id="map-grid"
            width="35"
            height="35"
            patternUnits="userSpaceOnUse"
          >
            <path d="M35 0H0V35" fill="none" stroke="#cbdad2" />
          </pattern>
        </defs>
        <rect width="440" height="200" fill="url(#map-grid)" />
        <path
          d={`M${a[0]} ${a[1]} L${b[0]} ${b[1]}`}
          stroke="#176e58"
          strokeDasharray="5 5"
          strokeWidth="3"
        />
        {points.map((p, i) => {
          const c = xy(p);
          return (
            <g key={i}>
              <circle
                cx={c[0]}
                cy={c[1]}
                r="10"
                fill={i === 2 ? "#e6ad68" : i === 0 ? "#176e58" : "#70968b"}
              />
              <text
                x={c[0]}
                y={c[1] + 4}
                textAnchor="middle"
                fill="white"
                fontSize="11"
              >
                {i === 0 ? "A" : i === 1 ? "B" : "К"}
              </text>
            </g>
          );
        })}
        <text x="15" y="185" fontSize="11" fill="#677d71">
          {t("Схематично · не дорожная карта")}{" "}
        </text>
      </svg>
    </div>
  );
}
function Profile({ t, user, me, lang, run, reload }: Any) {
  const [profile, setProfile] = useState<Any>({
      transport: user.profile.transport ?? "walk",
      city: user.profile.city ?? "Фергана",
      accepting: user.profile.accepting ?? false,
      language: user.profile.language ?? lang,
      notifications: user.profile.notifications ?? true,
      avatarId: user.profile.avatarId ?? null,
    }),
    [income, setIncome] = useState<Any[]>([]);
  useEffect(() => {
    api("income")
      .then(setIncome)
      .catch(() => {});
  }, []);
  return (
    <>
      <Title
        title={t("Профиль")}
        subtitle={t("Один аккаунт — все ваши возможности")}
      />
      <div className="detail-grid">
        <section className="card detail-card">
          <div className="profile-heading">
            <span className="avatar large">
              {user.profile.avatarId ? (
                <img src={"/api/avatars/" + user.id} alt={user.name} />
              ) : (
                user.name[0]
              )}
            </span>
            <div>
              <h2>{user.name}</h2>
              <p>{user.public_id}</p>
              <small>
                {user.phone} {t("· телефон подтвержден")}
              </small>
            </div>
          </div>
          <div
            className={
              "verification " + (user.identity === "verified" ? "verified" : "")
            }
          >
            <Icon name="shield" />
            <div>
              <b>
                {t(
                  user.identity === "verified"
                    ? "Личность подтверждена"
                    : "Личность не проверена",
                )}
              </b>
              <p>
                {t("Статус:")} {t(user.identity)}{" "}
                {t("· демонстрационный провайдер")}
              </p>
            </div>
          </div>
          {user.identity !== "verified" && (
            <button
              className="button"
              onClick={async () => {
                await run(() => api("verify", {}), "Демо-проверка выполнена");
                reload();
              }}
            >
              {t("Пройти демо-проверку")}
            </button>
          )}
          <p className="fine">
            {t(
              "Проверка личности не является гарантией надежности. MyID не подключен.",
            )}{" "}
          </p>
          <label>
            {t("Фото профиля — будет видно другим пользователям")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const form = new FormData();
                form.append("file", f);
                const r = await run(() => api("files", form), "Фото загружено");
                if (r) {
                  const updated = { ...profile, avatarId: r.id };
                  setProfile(updated);
                  await run(() => api("profile", updated));
                  reload();
                }
              }}
            />
          </label>
          <h3>{t("Настройки")}</h3>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await run(() => api("profile", profile));
              reload();
            }}
          >
            <label>
              {t("Транспорт")}
              <select
                value={profile.transport}
                onChange={(e) =>
                  setProfile({ ...profile, transport: e.target.value })
                }
              >
                {[
                  ["walk", "Пешком"],
                  ["bike", "Велосипед"],
                  ["car", "Автомобиль"],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {t(l)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Город")}
              <select
                value={profile.city}
                onChange={(e) =>
                  setProfile({ ...profile, city: e.target.value })
                }
              >
                {Object.keys(cities).map((c) => (
                  <option key={c} value={c}>
                    {t(c)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Язык / Til")}{" "}
              <select
                value={profile.language}
                onChange={(e) =>
                  setProfile({ ...profile, language: e.target.value })
                }
              >
                <option value="ru">{t("Русский")}</option>
                <option value="uz">O‘zbekcha</option>
              </select>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={profile.accepting}
                onChange={(e) =>
                  setProfile({ ...profile, accepting: e.target.checked })
                }
              />
              {t("Принимаю заказы")}
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={profile.notifications}
                onChange={(e) =>
                  setProfile({ ...profile, notifications: e.target.checked })
                }
              />
              {t("Уведомления")}
            </label>
            <button className="button">{t("Сохранить")}</button>
          </form>
        </section>
        <aside>
          <section className="card detail-card">
            <h2>{t("Ваша история")}</h2>
            {me.stats?.map((s: Any) => (
              <div className="stat-row" key={t(s.role)}>
                <span>
                  {t(
                    s.role === "sender"
                      ? "Посылок отправлено"
                      : "Доставок выполнено",
                  )}
                </span>
                <strong>{s.completed}</strong>
              </div>
            ))}
            <h3>{t("Отзывы")}</h3>
            {me.ratings?.map((r: Any) => (
              <div className="stat-row" key={t(r.role)}>
                <span>
                  {t(r.role)} · {r.count} {t("оценок")}{" "}
                </span>
                <strong>★ {r.average}</strong>
              </div>
            ))}
            {!me.ratings?.length && (
              <p className="muted">{t("Пока нет опубликованных отзывов")}</p>
            )}
          </section>
          <section className="card detail-card">
            <h2>{t("Доход")}</h2>
            <p>
              {t(
                "Учет начислений и выплат курьера. Это не банковский кошелек.",
              )}
            </p>
            {income.map((p) => (
              <div className="stat-row" key={p.id}>
                <span>
                  #{p.shipment_id.slice(0, 8)} · {t(p.status)}
                </span>
                <strong>{money(p.amount)}</strong>
              </div>
            ))}
            {!income.length && (
              <p className="muted">
                {t("Начисления появятся после завершения доставки.")}{" "}
              </p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
function Notifications({ t, open }: Any) {
  const [items, setItems] = useState<Any[]>([]);
  useEffect(() => {
    api("notifications")
      .then(setItems)
      .catch(() => {});
  }, []);
  return (
    <>
      <Title title={t("Уведомления")} />
      {items.map((n) => (
        <button
          className="card notification"
          key={n.id}
          onClick={() => open(n.shipment_id)}
        >
          <Icon name="bell" />
          <div>
            <b>{t(n.text)}</b>
            <p>{time(n.created_at)}</p>
          </div>
        </button>
      ))}
      {!items.length && (
        <Empty
          title={t("Пока нет уведомлений")}
          text={t("События ваших доставок будут появляться здесь.")}
        />
      )}
    </>
  );
}
function Admin({ t, user, run }: Any) {
  const [data, setData] = useState<Any | null>(null),
    [view, setView] = useState("shipments"),
    [config, setConfig] = useState("");
  async function load() {
    const r = await run(() => api("admin"), "");
    if (r) {
      setData(r);
      setConfig(JSON.stringify(r.settings, null, 2));
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function action(path: string, body: Any) {
    const r = await run(() => api(path, body));
    if (r) load();
  }
  if (!data) return <p>{t("Загрузка…")}</p>;
  const sections = [
    "point_requests",
    "shipments",
    "users",
    "disputes",
    "payments",
    "payouts",
    "refunds",
    "lockers",
    "reports",
    "audit",
    "settings",
  ];
  const labels: Any = {
    point_requests: "Операции пункта",
    shipments: "Заказы",
    users: "Пользователи",
    disputes: "Споры",
    payments: "Платежи",
    payouts: "Выплаты",
    refunds: "Возвраты",
    lockers: "Постаматы и пункты",
    reports: "Жалобы",
    audit: "Аудит",
    settings: "Тарифы и зоны",
  };
  return (
    <>
      <Title
        title={t("Администрирование")}
        subtitle={"Роль: " + user.role + " · действия записываются в аудит"}
      />
      <div className="metric-grid">
        {[
          ["published", "Опубликованы"],
          ["completed", "Завершены"],
          ["assigned_share", "Доля назначений"],
          ["assignment_minutes", "Минут до назначения"],
          ["ontime_share", "Доставлены вовремя"],
          ["cancelled", "Отмены"],
          ["disputes", "Открытые споры"],
          ["repeat_senders", "Повторные отправители"],
          ["active_couriers", "Активные курьеры"],
          ["money", "Объем платежей"],
          ["fees", "Комиссии"],
          ["refunded", "Возвраты сум"],
        ].map(([k, l]) => (
          <div className="card metric" key={k}>
            <small>{t(l)}</small>
            <strong>
              {data.metrics[k] == null
                ? "—"
                : k.includes("share")
                  ? Math.round(data.metrics[k] * 100) + "%"
                  : k === "assignment_minutes"
                    ? Number(data.metrics[k]).toFixed(1)
                    : data.metrics[k]}
            </strong>
          </div>
        ))}
      </div>
      <p className="fine">
        {t(
          "Статистика рассчитана из базы; «—» означает отсутствие данных. Формулы описаны в README.",
        )}{" "}
      </p>
      <div className="admin-tabs">
        {sections
          .filter((s) =>
            user.role === "admin" || user.role === "operator"
              ? user.role === "admin" ||
                ["lockers", "point_requests"].includes(s)
              : user.role === "finance"
                ? ["shipments", "payments", "payouts", "refunds"].includes(s)
                : ["shipments", "disputes", "reports", "lockers"].includes(s),
          )
          .map((s) => (
            <button
              key={s}
              className={view === s ? "active" : ""}
              onClick={() => setView(s)}
            >
              {t(labels[s])}
            </button>
          ))}
      </div>
      <section className="card detail-card">
        <h2>{t(labels[view])}</h2>
        {view === "settings" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                action("admin.settings", JSON.parse(config));
              } catch {
                alert("Неверный JSON");
              }
            }}
          >
            <label>
              {t("Название, лимиты, тарифы, запрещенные категории")}{" "}
              <textarea
                className="config-editor"
                value={config}
                onChange={(e) => setConfig(e.target.value)}
              />
            </label>
            <button className="button">{t("Сохранить")}</button>
          </form>
        ) : (
          <div className="admin-list">
            {(data[view] ?? []).map((item: Any, i: number) => (
              <div className="admin-row" key={item.id ?? i}>
                <div>
                  <b>
                    {item.name ??
                      item.reason ??
                      item.action ??
                      "#" + (item.shipment_id ?? item.id ?? "").slice(0, 8)}
                  </b>
                  <p>
                    {view === "users"
                      ? `${item.public_id} · ${item.identity} · ${item.role}`
                      : view === "lockers"
                        ? `${item.city} · ${item.connected ? "в сети" : "нет связи"} · ${item.fault ?? "исправен"}`
                        : view === "shipments"
                          ? `${item.status} · посылка: ${item.location} · спор: ${item.dispute_status}`
                          : view === "audit"
                            ? `${item.entity_id} · ${time(item.created_at)}`
                            : `${item.status ?? ""} ${item.amount ? money(item.amount) : ""} ${item.resolution ?? ""}`}
                  </p>
                  {view === "disputes" && (
                    <small>
                      {t("Заказ #")}
                      {item.shipment_id.slice(0, 8)}
                    </small>
                  )}
                </div>
                <div className="row">
                  {view === "point_requests" && (
                    <button
                      className="button"
                      onClick={() =>
                        action("admin/point.confirm", { requestId: item.id })
                      }
                    >
                      {t("Подтвердить")} {item.operation}
                    </button>
                  )}
                  {view === "reports" && item.status === "open" && (
                    <button
                      className="button secondary"
                      onClick={() =>
                        action("admin/moderate", {
                          reportId: item.id,
                          hide: true,
                        })
                      }
                    >
                      {t("Скрыть сообщение")}{" "}
                    </button>
                  )}
                  {view === "users" && (
                    <button
                      className="button secondary"
                      onClick={() =>
                        action("admin.user", {
                          id: item.id,
                          restricted: !item.restricted,
                        })
                      }
                    >
                      {t(item.restricted ? "Снять ограничение" : "Ограничить")}
                    </button>
                  )}
                  {view === "disputes" &&
                    item.status === "open" &&
                    user.role === "admin" && (
                      <button
                        className="button"
                        onClick={() => {
                          const resolution = prompt(
                            "Решение спора (не менее 5 символов)",
                          );
                          if (resolution)
                            action("admin/resolve", {
                              shipmentId: item.shipment_id,
                              resolution,
                            });
                        }}
                      >
                        {t("Решить спор")}{" "}
                      </button>
                    )}
                  {view === "payouts" && item.status === "pending" && (
                    <button
                      className="button"
                      onClick={() =>
                        action("admin/payout", { shipmentId: item.shipment_id })
                      }
                    >
                      {t("Выплатить (демо)")}{" "}
                    </button>
                  )}
                  {view === "refunds" && item.status === "pending" && (
                    <button
                      className="button"
                      onClick={() =>
                        action("admin/refund", { shipmentId: item.shipment_id })
                      }
                    >
                      {t("Вернуть (демо)")}{" "}
                    </button>
                  )}
                  {view === "lockers" && user.role === "admin" && (
                    <>
                      <button
                        className="button secondary"
                        onClick={() =>
                          action("admin.locker", {
                            id: item.id,
                            connected: !item.connected,
                            fault: item.fault ?? "none",
                          })
                        }
                      >
                        {t(
                          item.connected
                            ? "Потеря связи"
                            : "Восстановить связь",
                        )}
                      </button>
                      <select
                        aria-label={t("Неисправность симулятора")}
                        value={item.fault ?? "none"}
                        onChange={(e) =>
                          action("admin.locker", {
                            id: item.id,
                            connected: item.connected,
                            fault: e.target.value,
                          })
                        }
                      >
                        <option value="none">{t("Исправен")}</option>
                        <option value="door">{t("Дверь не открылась")}</option>
                        <option value="full">{t("Нет ячеек")}</option>
                      </select>
                    </>
                  )}
                  {view === "disputes" &&
                    item.evidence?.map((f: string) => (
                      <a href={"/api/admin/files/" + f} target="_blank" key={f}>
                        {t("Доказательство")}{" "}
                      </a>
                    ))}
                </div>
              </div>
            ))}
            {!(data[view] ?? []).length && (
              <p className="muted">{t("Записей пока нет")}</p>
            )}
          </div>
        )}
      </section>
    </>
  );
}
