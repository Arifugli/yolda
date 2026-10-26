"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  serviceLabels,
  serviceStatuses,
  serviceVehicles,
  vehicleLabels,
  type ServiceKind,
  type VehicleKind,
} from "@/lib/mobility-catalog";
import TaxiMap, { type TaxiPoints } from "./taxi-map";
type Row = Record<string, any>;
type Props = {
  user: Row;
  kind: ServiceKind;
  initialId?: string | null;
  api: (path: string, body?: any) => Promise<any>;
  t: (label: string) => string;
};
const money = (n: number) => new Intl.NumberFormat("ru-UZ").format(n) + " сум";
const localDate = () => {
  const d = new Date(Date.now() + 15 * 60000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const when = (s: string) =>
  new Intl.DateTimeFormat("ru", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(new Date(s));
export default function Mobility({ user, kind, initialId, api, t }: Props) {
  const [view, setView] = useState("mine"),
    [rows, setRows] = useState<Row[]>([]),
    [vehicles, setVehicles] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(initialId ?? null),
    [detail, setDetail] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [code, setCode] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [r, v, d] = await Promise.all([
          api(
            `mobility?kind=${kind}&view=${view === "vehicles" ? "mine" : view}`,
          ),
          api("mobility/vehicles"),
          selected ? api("mobility/" + selected) : Promise.resolve(null),
        ]);
        let current = d;
        if (
          d?.kind === "taxi" &&
          d.customer_id === user.id &&
          ["published", "driver_pending"].includes(d.status)
        ) {
          await api(`mobility/${d.id}/dispatch`, {});
          current = await api("mobility/" + d.id);
        }
        if (active) {
          setRows(r);
          setVehicles(v);
          setDetail(current);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(load, 7000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [kind, view, selected, revision, api]);
  async function submit(path: string, body: object) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api(path, body);
      setRevision((n) => n + 1);
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const action = (name: string, body: object = {}) =>
    submit(`mobility/${selected}/${name}`, body);
  const open = (id: string) => {
    setDetail(null);
    setCode("");
    setSelected(id);
    setError("");
  };
  const owner = detail?.customer_id === user.id,
    performer = detail?.provider_id === user.id;
  const support = ["admin", "support"].includes(user.role),
    member = owner || performer;
  return (
    <section className="mobility">
      <div className="page-title">
        <div>
          <span className="eyebrow">
            {t("Один профиль — заказчик и исполнитель")}
          </span>
          <h1>{t(serviceLabels[kind])}</h1>
          <p>{t("Закажите услугу или выполняйте заявки на своей машине.")}</p>
        </div>
        {!creating && !selected && (
          <button className="button" onClick={() => setCreating(true)}>
            {t(kind === "taxi" ? "Заказать поездку" : "Создать заявку")}
          </button>
        )}
      </div>
      <p className="service-note">
        {t(
          kind === "taxi"
            ? "Автопоиск: ближайшая доступная машина в радиусе 8 км по прямой. Водитель должен подтвердить поездку за 45 секунд. Геопозиция должна быть свежее двух минут."
            : "Выберите исполнителя и цену из предложений. Реальные платежи и проверка разрешений пока не подключены.",
        )}
      </p>
      {error && (
        <div className="alert error" role="alert">
          {t(error)}
          <button aria-label={t("Закрыть")} onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {!selected && !creating && (
        <div
          className="service-tabs"
          role="group"
          aria-label={t("Раздел услуг")}
        >
          {[
            ["mine", "Мои заявки"],
            ...(kind !== "taxi" ? [["market", "Найти работу"]] : []),
            ["vehicles", "Мои машины"],
            ...(support ? [["support", "Споры"]] : []),
          ].map(([id, label]) => (
            <button
              key={id}
              className={view === id ? "button" : "button secondary"}
              onClick={() => {
                setView(id);
                setError("");
              }}
            >
              {t(label)}
            </button>
          ))}
        </div>
      )}
      {creating ? (
        <ServiceForm
          kind={kind}
          city={user.profile.city ?? "Фергана"}
          api={api}
          t={t}
          busy={busy}
          cancel={() => setCreating(false)}
          done={async (b) => {
            const r = await submit("mobility", b);
            if (r) {
              setCreating(false);
              setView("mine");
              open(r.id);
            }
          }}
        />
      ) : selected ? (
        <>
          <button
            className="text-button"
            onClick={() => {
              setSelected(null);
              setCode("");
              setError("");
            }}
          >
            {t("Назад")}
          </button>
          {!detail ? (
            <p role="status">{t("Загрузка…")}</p>
          ) : (
            <>
              <article className="card service-detail">
                <span className="pill">
                  {t(serviceStatuses[detail.status])}
                </span>
                <h2>
                  {t(vehicleLabels[detail.data.vehicleKind as VehicleKind])}
                </h2>
                <p>
                  {detail.data.origin.city}
                  {detail.data.origin.address
                    ? " · " + detail.data.origin.address
                    : ""}
                  {detail.data.destination
                    ? " → " +
                      detail.data.destination.city +
                      (detail.data.destination.address
                        ? " · " + detail.data.destination.address
                        : "")
                    : ""}
                </p>
                <p>
                  {when(detail.data.scheduledAt)} · {t("Время Ташкента")}
                </p>
                <p>
                  {detail.data.description ??
                    detail.data.publicSummary ??
                    t(
                      "Точные адреса и описание откроются выбранному исполнителю.",
                    )}
                </p>
                <Requirements data={detail.data} kind={kind} t={t} />
                <p>
                  <b>
                    {t(detail.agreed_price ? "Согласованная цена" : "Бюджет")}:{" "}
                    {money(detail.agreed_price ?? detail.data.budget)}
                  </b>{" "}
                  · {t("за весь заказ")}
                </p>
                {!!detail.participants?.length && (
                  <p>
                    {detail.participants
                      .map(
                        (p: Row) =>
                          p.name +
                          (p.id === detail.customer_id
                            ? " (" + t("Заказчик") + ")"
                            : " (" + t("Исполнитель") + ")"),
                      )
                      .join(" · ")}
                  </p>
                )}
                <div className="service-actions">
                  {owner &&
                    kind === "taxi" &&
                    ["published", "driver_pending"].includes(detail.status) && (
                      <p role="status">
                        {t(
                          detail.status === "published"
                            ? "Автоматически ищем ближайшего водителя. Для поездок позже поиск начнётся за 20 минут до подачи."
                            : "Ожидаем подтверждения водителя. При отказе поиск продолжится автоматически.",
                        )}
                      </p>
                    )}
                  {performer && detail.status === "driver_pending" && (
                    <>
                      <button
                        disabled={busy}
                        className="button"
                        onClick={() => action("accept")}
                      >
                        {t("Принять поездку")}
                      </button>
                      <button
                        disabled={busy}
                        className="button secondary"
                        onClick={async () => {
                          if (await action("decline")) {
                            setSelected(null);
                            setDetail(null);
                          }
                        }}
                      >
                        {t("Отклонить поездку")}
                      </button>
                    </>
                  )}
                  {performer && detail.status === "assigned" && (
                    <button
                      disabled={busy}
                      className="button"
                      onClick={() => action("arrive")}
                    >
                      {t("Я прибыл")}
                    </button>
                  )}
                  {owner && detail.status === "arrived" && (
                    <button
                      disabled={busy}
                      className="button"
                      onClick={async () => {
                        const r = await action("code");
                        if (r) setCode(r.code);
                      }}
                    >
                      {t("Получить код начала")}
                    </button>
                  )}
                  {code && owner && detail.status === "arrived" && (
                    <div className="handover-code">
                      <small>
                        {t("Назовите код исполнителю при встрече · 5 минут")}
                      </small>
                      <strong>{code}</strong>
                    </div>
                  )}
                  {performer && detail.status === "arrived" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void action("start", { code: f.get("code") });
                      }}
                    >
                      <label>
                        {t("Код начала от заказчика")}
                        <input
                          name="code"
                          inputMode="numeric"
                          required
                          pattern="[0-9]{6}"
                          maxLength={6}
                        />
                      </label>
                      <button disabled={busy} className="button">
                        {t(
                          kind === "taxi" ? "Начать поездку" : "Начать работу",
                        )}
                      </button>
                    </form>
                  )}
                  {performer && detail.status === "in_progress" && (
                    <button
                      disabled={busy}
                      className="button"
                      onClick={() => action("finish")}
                    >
                      {t("Сообщить о выполнении")}
                    </button>
                  )}
                  {owner && detail.status === "awaiting_confirmation" && (
                    <button
                      disabled={busy || detail.dispute_status === "open"}
                      className="button"
                      onClick={() => action("complete")}
                    >
                      {t("Подтвердить выполнение")}
                    </button>
                  )}
                  {owner &&
                    [
                      "published",
                      "driver_pending",
                      "assigned",
                      "arrived",
                    ].includes(detail.status) && (
                      <button
                        disabled={busy}
                        className="button secondary"
                        onClick={() => action("cancel")}
                      >
                        {t("Отменить заявку")}
                      </button>
                    )}
                  {performer &&
                    ["assigned", "arrived"].includes(detail.status) && (
                      <button
                        disabled={busy}
                        className="button secondary"
                        onClick={() => action("decline")}
                      >
                        {t("Отказаться до начала")}
                      </button>
                    )}
                </div>
              </article>
              {kind !== "taxi" &&
                !member &&
                !support &&
                detail.status === "published" && (
                  <article className="card service-detail">
                    <h2>{t("Предложить свои услуги")}</h2>
                    {user.identity !== "verified" ? (
                      <p>
                        {t("Сначала пройдите проверку личности в профиле.")}
                      </p>
                    ) : !vehicles.some(
                        (v) => v.active && v.kind === detail.data.vehicleKind,
                      ) ? (
                      <>
                        <p>
                          {t(
                            "Добавьте подходящую машину в разделе «Мои машины».",
                          )}
                        </p>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setSelected(null);
                            setView("vehicles");
                          }}
                        >
                          {t("Мои машины")}
                        </button>
                      </>
                    ) : (
                      <form
                        className="form-grid"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void action("offer", {
                            vehicleId: f.get("vehicleId"),
                            price: Number(f.get("price")),
                            comment: f.get("comment"),
                          });
                        }}
                      >
                        <label>
                          {t("Машина")}
                          <select
                            aria-label={t("Машина")}
                            name="vehicleId"
                            required
                            defaultValue={detail.myOffer?.vehicle_id}
                          >
                            {vehicles
                              .filter(
                                (v) =>
                                  v.active &&
                                  v.kind === detail.data.vehicleKind,
                              )
                              .map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.data.name} · {v.data.plate}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          {t("Предложение за весь заказ, сум")}
                          <input
                            name="price"
                            type="number"
                            min="1000"
                            max="1000000000"
                            step="1"
                            required
                            defaultValue={
                              detail.myOffer?.price ?? detail.data.budget
                            }
                          />
                        </label>
                        <label>
                          {t("Комментарий")}
                          <textarea
                            name="comment"
                            maxLength={500}
                            defaultValue={detail.myOffer?.comment ?? ""}
                          />
                        </label>
                        <button disabled={busy} className="button">
                          {t(
                            detail.myOffer
                              ? "Обновить предложение"
                              : "Откликнуться",
                          )}
                        </button>
                      </form>
                    )}
                    {detail.myOffer && (
                      <button
                        disabled={busy}
                        className="text-button"
                        onClick={() => action("withdraw")}
                      >
                        {t("Отозвать предложение")}
                      </button>
                    )}
                  </article>
                )}
              {(owner || support) && detail.offers?.length > 0 && (
                <article className="card service-detail">
                  <h2>{t("Предложения исполнителей")}</h2>
                  {detail.offers.map((o: Row) => (
                    <div className="service-offer" key={o.provider_id}>
                      <div>
                        <b>
                          {o.name} · {money(o.price)}
                        </b>
                        <p>
                          {o.vehicle.name} ·{" "}
                          {t(vehicleLabels[o.kind as VehicleKind])} ·{" "}
                          {o.vehicle.plate}
                        </p>
                        <p>{o.comment}</p>
                      </div>
                      {owner && detail.status === "published" && (
                        <button
                          disabled={busy}
                          className="button"
                          onClick={() =>
                            action("assign", { providerId: o.provider_id })
                          }
                        >
                          {t("Выбрать исполнителя")}
                        </button>
                      )}
                    </div>
                  ))}
                </article>
              )}
              {detail.provider_id && (member || support) && (
                <article className="card service-detail">
                  <h2>{t("Чат заявки")}</h2>
                  <div className="service-chat" aria-live="polite">
                    {detail.messages?.map((m: Row) => (
                      <p key={m.id}>
                        <b>{m.name}</b>: {m.text}
                      </p>
                    ))}
                  </div>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const text = new FormData(form).get("text");
                      if (await action("message", { text })) form.reset();
                    }}
                  >
                    <label>
                      {t("Сообщение")}
                      <input name="text" required maxLength={2000} />
                    </label>
                    <button disabled={busy} className="button secondary">
                      {t("Отправить")}
                    </button>
                  </form>
                </article>
              )}
              {(member || support) &&
                detail.status !== "published" &&
                detail.status !== "cancelled" && (
                  <article className="card service-detail">
                    <h2>{t("Поддержка")}</h2>
                    {detail.dispute_status === "open" ? (
                      <>
                        <p role="status">
                          {t("Открыт спор")}: {detail.dispute_reason}
                        </p>
                        {support && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void action("resolve", {
                                resolution: new FormData(e.currentTarget).get(
                                  "resolution",
                                ),
                              });
                            }}
                          >
                            <label>
                              {t("Решение поддержки")}
                              <textarea
                                name="resolution"
                                required
                                minLength={5}
                                maxLength={1000}
                              />
                            </label>
                            <button disabled={busy} className="button">
                              {t("Разрешить спор")}
                            </button>
                          </form>
                        )}
                      </>
                    ) : (
                      <>
                        {detail.dispute_resolution && (
                          <p>
                            {t("Решение поддержки")}:{" "}
                            {detail.dispute_resolution}
                          </p>
                        )}
                        {member && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void action("dispute", {
                                reason: new FormData(e.currentTarget).get(
                                  "reason",
                                ),
                              });
                            }}
                          >
                            <label>
                              {t("Причина обращения")}
                              <textarea
                                name="reason"
                                required
                                minLength={5}
                                maxLength={1000}
                              />
                            </label>
                            <button
                              disabled={busy}
                              className="button secondary"
                            >
                              {t("Открыть спор")}
                            </button>
                          </form>
                        )}
                      </>
                    )}
                  </article>
                )}
              {member &&
                detail.status === "completed" &&
                !detail.reviews?.some((r: Row) => r.author_id === user.id) && (
                  <article className="card service-detail">
                    <h2>{t("Оценить участника")}</h2>
                    <p>
                      {t(
                        "Отзывы публикуются после ответа обеих сторон или через семь дней.",
                      )}
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void action("review", {
                          stars: Number(f.get("stars")),
                          comment: f.get("comment"),
                        });
                      }}
                    >
                      <label>
                        {t("Оценка")}
                        <select
                          aria-label={t("Оценка")}
                          name="stars"
                          defaultValue="5"
                        >
                          {[5, 4, 3, 2, 1].map((n) => (
                            <option key={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t("Комментарий")}
                        <textarea name="comment" maxLength={1000} />
                      </label>
                      <button disabled={busy} className="button">
                        {t("Оставить отзыв")}
                      </button>
                    </form>
                  </article>
                )}
              {detail.reviews?.map((r: Row) => (
                <p className="card service-detail" key={r.author_id}>
                  {r.stars} / 5 · {r.comment}
                </p>
              ))}
              {detail.events?.length > 0 && (
                <details className="card service-detail">
                  <summary>{t("История заявки")}</summary>
                  {detail.events.map((e: Row) => (
                    <p key={e.id}>
                      {when(e.created_at)} · {t(e.detail)}
                    </p>
                  ))}
                </details>
              )}
            </>
          )}
        </>
      ) : view === "vehicles" ? (
        <>
          <VehicleForm
            busy={busy}
            t={t}
            done={(b) => submit("mobility/vehicles", b)}
            verified={user.identity === "verified"}
          />
          {vehicles.map((v) => (
            <article className="card service-detail" key={v.id}>
              <h3>
                {v.data.name} · {t(vehicleLabels[v.kind as VehicleKind])}
              </h3>
              <p>
                {v.data.plate} · {v.data.seats} {t("мест")} ·{" "}
                {v.data.capacityTonnes} {t("тонн")}
                {v.kind === "crane"
                  ? ` · ${v.data.liftTonnes} т / ${v.data.reachMeters} м`
                  : ""}
              </p>
              <button
                disabled={busy}
                className="button secondary"
                onClick={() =>
                  submit("mobility/vehicles", {
                    ...v.data,
                    id: v.id,
                    active: !v.active,
                  })
                }
              >
                {t(
                  v.active
                    ? "Приостановить приём заявок"
                    : "Включить приём заявок",
                )}
              </button>
            </article>
          ))}
        </>
      ) : (
        <div className="order-grid">
          {rows.map((s) => (
            <button
              className="card service-card"
              key={s.id}
              onClick={() => open(s.id)}
            >
              <span className="pill">{t(serviceStatuses[s.status])}</span>
              <h3>{t(vehicleLabels[s.data.vehicleKind as VehicleKind])}</h3>
              <p>
                {s.data.origin.city}
                {s.data.destination ? " → " + s.data.destination.city : ""}
              </p>
              <p>{when(s.data.scheduledAt)}</p>
              {s.data.publicSummary && <p>{s.data.publicSummary}</p>}
              <Requirements data={s.data} kind={kind} t={t} />
              <b>{money(s.agreed_price ?? s.data.budget)}</b>
            </button>
          ))}
          {rows.length === 0 && (
            <p className="card service-detail">
              {t(
                view === "market"
                  ? "Свободных заявок пока нет"
                  : "Здесь появятся ваши заявки и отклики.",
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
function Requirements({
  data,
  kind,
  t,
}: {
  data: Row;
  kind: ServiceKind;
  t: Props["t"];
}) {
  return (
    <p className="muted">
      {kind === "taxi"
        ? `${data.passengers} ${t("пассажиров")}`
        : kind === "cargo"
          ? `${data.weightTonnes} ${t("тонн")}`
          : `${data.durationHours} ${t("часов работы")}${data.vehicleKind === "crane" ? ` · ${data.liftTonnes} т / ${data.reachMeters} м` : ""}`}
    </p>
  );
}
function ServiceForm({
  kind,
  city,
  api,
  t,
  busy,
  cancel,
  done,
}: {
  kind: ServiceKind;
  city: string;
  api: Props["api"];
  t: Props["t"];
  busy: boolean;
  cancel: () => void;
  done: (b: Row) => Promise<void>;
}) {
  const [vehicle, setVehicle] = useState<VehicleKind>(serviceVehicles[kind][0]);
  const [points, setPoints] = useState<TaxiPoints>({
      origin: { lat: "", lng: "" },
      destination: { lat: "", lng: "" },
    }),
    [quote, setQuote] = useState<Row | null>(null),
    [error, setError] = useState("");
  const changePoints = (p: TaxiPoints) => {
    setPoints(p);
    setQuote(null);
  };
  const coords = () => ({
    origin: { lat: Number(points.origin.lat), lng: Number(points.origin.lng) },
    destination: {
      lat: Number(points.destination.lat),
      lng: Number(points.destination.lng),
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const number = (n: string, fallback = 0) => Number(f.get(n) ?? fallback);
    if (kind === "taxi" && !quote) {
      setError(t("Сначала рассчитайте стоимость поездки"));
      return;
    }
    void done({
      kind,
      vehicleKind: vehicle,
      origin: {
        city: f.get("originCity"),
        address: f.get("originAddress"),
        ...(kind === "taxi" ? coords().origin : {}),
      },
      ...(kind !== "equipment"
        ? {
            destination: {
              city: f.get("destinationCity"),
              address: f.get("destinationAddress"),
              ...(kind === "taxi" ? coords().destination : {}),
            },
          }
        : {}),
      description: f.get("description"),
      publicSummary:
        kind === "taxi" ? "Поездка на такси" : f.get("publicSummary"),
      scheduledAt: new Date(String(f.get("scheduledAt"))).toISOString(),
      budget: kind === "taxi" ? quote!.price : number("budget"),
      passengers: number("passengers", 1),
      weightTonnes: number("weightTonnes"),
      liftTonnes: number("liftTonnes"),
      reachMeters: number("reachMeters"),
      durationHours: number("durationHours", 1),
      safetyConfirmed: f.get("safety") === "on",
    });
  }
  return (
    <form className="card service-detail" onSubmit={submit}>
      <button type="button" className="text-button" onClick={cancel}>
        {t("Назад")}
      </button>
      <h2>{t(kind === "taxi" ? "Новая поездка" : "Новая заявка")}</h2>
      <div className="form-grid">
        <label>
          {t("Тип машины")}
          <select
            aria-label={t("Тип машины")}
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value as VehicleKind)}
          >
            {serviceVehicles[kind].map((v) => (
              <option key={v} value={v}>
                {t(vehicleLabels[v])}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Дата и время подачи")}
          <input
            type="datetime-local"
            name="scheduledAt"
            defaultValue={localDate()}
            required
          />
        </label>
        <label>
          {t("Город подачи")}
          <input
            name="originCity"
            defaultValue={city}
            minLength={2}
            maxLength={80}
            required
          />
        </label>
        <label>
          {t(kind === "equipment" ? "Адрес работ" : "Откуда")}
          <input name="originAddress" required minLength={3} maxLength={300} />
        </label>
        {kind !== "equipment" && (
          <>
            <label>
              {t("Город назначения")}
              <input
                name="destinationCity"
                defaultValue={city}
                required
                minLength={2}
                maxLength={80}
              />
            </label>
            <label>
              {t("Куда")}
              <input
                name="destinationAddress"
                required
                minLength={3}
                maxLength={300}
              />
            </label>
          </>
        )}
        {kind === "taxi" ? (
          <label>
            {t("Количество пассажиров")}
            <input
              name="passengers"
              type="number"
              defaultValue="1"
              min="1"
              max="20"
              step="1"
              required
            />
          </label>
        ) : kind === "cargo" ? (
          <label>
            {t("Масса груза, тонн")}
            <input
              name="weightTonnes"
              type="number"
              min="0.001"
              max="1000"
              step="0.001"
              required
            />
          </label>
        ) : (
          <label>
            {t("Длительность работ, часов")}
            <input
              name="durationHours"
              type="number"
              min="0.5"
              max="720"
              step="0.5"
              defaultValue="1"
              required
            />
          </label>
        )}
        {vehicle === "crane" && (
          <>
            <label>
              {t("Масса подъёма, тонн")}
              <input
                name="liftTonnes"
                type="number"
                min="0.1"
                max="1000"
                step="0.1"
                required
              />
            </label>
            <label>
              {t("Вылет стрелы, метров")}
              <input
                name="reachMeters"
                type="number"
                min="0.1"
                max="300"
                step="0.1"
                required
              />
            </label>
          </>
        )}
        {kind !== "taxi" && (
          <label>
            {t("Бюджет за весь заказ, сум")}
            <input
              name="budget"
              type="number"
              min="1000"
              max="1000000000"
              step="1"
              defaultValue={200000}
              required
            />
          </label>
        )}
        {kind !== "taxi" && (
          <label>
            {t("Кратко о грузе или работе — видно исполнителям")}
            <input
              name="publicSummary"
              required
              minLength={3}
              maxLength={200}
              defaultValue={
                kind === "cargo" ? "Перевозка груза" : "Работы на объекте"
              }
            />
            <small>
              {t(
                "Без точных адресов и контактов. Подробности откроются выбранному исполнителю.",
              )}
            </small>
          </label>
        )}
        <label>
          {t(
            kind === "taxi"
              ? "Пожелания к поездке"
              : "Описание груза или работ, размеры, условия доступа",
          )}
          <textarea
            name="description"
            required
            minLength={3}
            maxLength={1500}
          />
        </label>
      </div>
      {kind === "taxi" && (
        <>
          <TaxiMap points={points} setPoints={changePoints} t={t} />
          <button
            type="button"
            className="button secondary"
            disabled={Object.values(points).some((p) => !p.lat || !p.lng)}
            onClick={async () => {
              try {
                setError("");
                setQuote(await api("mobility/quote", coords()));
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {t("Рассчитать стоимость")}
          </button>
          {quote && (
            <p role="status">
              {t("Стоимость поездки")}: <b>{money(quote.price)}</b> ·{" "}
              {quote.distanceKm} {t("км по прямой")}
            </p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <label className="service-consent">
        <input name="safety" type="checkbox" required />
        {t(
          "Согласую безопасную посадку, допустимый груз и условия работ с исполнителем.",
        )}
      </label>
      <p>
        {t(
          kind === "taxi"
            ? "Подтверждая заказ, вы соглашаетесь с рассчитанной ценой. Онлайн-оплата пока не подключена."
            : "Цена за весь заказ согласуется при выборе предложения. Приём и выплата денег в этом разделе пока не подключены.",
        )}
      </p>
      <button disabled={busy || (kind === "taxi" && !quote)} className="button">
        {t("Опубликовать заявку")}
      </button>
    </form>
  );
}
function VehicleForm({
  busy,
  t,
  done,
  verified,
}: {
  busy: boolean;
  t: Props["t"];
  done: (b: Row) => Promise<any>;
  verified: boolean;
}) {
  const [kind, setKind] = useState<VehicleKind>("sedan");
  return (
    <form
      className="card service-detail"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        if (
          await done({
            kind,
            name: f.get("name"),
            plate: f.get("plate"),
            seats: Number(f.get("seats") ?? 4),
            capacityTonnes: Number(f.get("capacityTonnes") ?? 0),
            liftTonnes: Number(f.get("liftTonnes") ?? 0),
            reachMeters: Number(f.get("reachMeters") ?? 0),
            active: true,
            qualificationsConfirmed: f.get("qualifications") === "on",
          })
        )
          form.reset();
      }}
    >
      <h2>{t("Добавить машину")}</h2>
      {!verified ? (
        <p>{t("Сначала пройдите проверку личности в профиле.")}</p>
      ) : (
        <>
          <div className="form-grid">
            <label>
              {t("Тип машины")}
              <select
                aria-label={t("Тип машины")}
                value={kind}
                onChange={(e) => setKind(e.target.value as VehicleKind)}
              >
                {Object.entries(vehicleLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {t(v)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Марка и модель")}
              <input name="name" minLength={2} maxLength={100} required />
            </label>
            <label>
              {t("Госномер")}
              <input name="plate" minLength={3} maxLength={30} required />
            </label>
            {["sedan", "minivan"].includes(kind) ? (
              <label>
                {t("Пассажирских мест")}
                <input
                  name="seats"
                  type="number"
                  min="1"
                  max="20"
                  step="1"
                  defaultValue="4"
                  required
                />
              </label>
            ) : ["van", "truck", "dump_truck", "semi_trailer"].includes(
                kind,
              ) ? (
              <label>
                {t("Грузоподъёмность, тонн")}
                <input
                  name="capacityTonnes"
                  type="number"
                  min="0.001"
                  max="1000"
                  step="0.001"
                  required
                />
              </label>
            ) : null}
            {kind === "crane" && (
              <>
                <label>
                  {t("Грузоподъёмность крана, тонн")}
                  <input
                    name="liftTonnes"
                    type="number"
                    min="0.1"
                    max="1000"
                    step="0.1"
                    required
                  />
                </label>
                <label>
                  {t("Вылет стрелы, метров")}
                  <input
                    name="reachMeters"
                    type="number"
                    min="0.1"
                    max="300"
                    step="0.1"
                    required
                  />
                </label>
              </>
            )}
          </div>
          <label className="service-consent">
            <input name="qualifications" type="checkbox" required />
            {t(
              "Подтверждаю право управления, доступ к машине и необходимые разрешения. Платформа пока не проверяет документы автоматически.",
            )}
          </label>
          <button disabled={busy} className="button">
            {t("Сохранить машину")}
          </button>
        </>
      )}
    </form>
  );
}
