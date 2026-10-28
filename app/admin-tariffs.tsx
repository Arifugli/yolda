"use client";
import { useEffect, useState, type FormEvent } from "react";
import { vehicleLabels } from "@/lib/mobility-catalog";
type Tariff = {
  service_type: string;
  code: string;
  version: number;
  rules: Record<string, number>;
  active: boolean;
  created_at: string;
};
const labels: Record<string, string> = {
  ride: "Такси",
  freight: "Грузоперевозки",
  equipment: "Спецтехника",
};
const fields: Record<string, string> = {
  base: "Базовая стоимость, сум",
  perKm: "За километр, сум",
  perHour: "За час, сум",
  minimum: "Минимальная цена, сум",
  roundTo: "Округление вверх, сум",
  maxKm: "Максимальное расстояние, км",
};
export default function AdminTariffs({
  api,
  t,
}: {
  api: (path: string, body?: any) => Promise<any>;
  t: (s: string) => string;
}) {
  const [rows, setRows] = useState<Tariff[]>([]),
    [selected, setSelected] = useState<Tariff | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  async function load() {
    setLoading(true);
    setError("");
    try {
      setRows(await api("admin/tariffs"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected || saving) return;
    const f = new FormData(e.currentTarget),
      rules = { ...selected.rules };
    for (const key of Object.keys(fields))
      if (f.has(key)) rules[key] = Number(f.get(key));
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api("admin.tariff", {
        serviceType: selected.service_type,
        code: selected.code,
        expectedVersion: selected.version,
        rules,
        reason: f.get("reason"),
      });
      setSelected(null);
      setNotice(
        t(
          "Новая версия тарифа сохранена. Цены существующих заказов не изменены.",
        ),
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="tariff-editor">
      <p>
        {t(
          "Изменения применяются к новым заказам. Уже рассчитанная цена проверяется повторно при подтверждении.",
        )}
      </p>
      <p>{t("Тарифы доставки и зоны доступны в разделе «Тарифы и зоны».")}</p>
      {error && <p role="alert">{t(error)}</p>}
      {notice && <p role="status">{notice}</p>}
      <button
        type="button"
        className="button secondary"
        disabled={loading || saving}
        onClick={() => {
          setSelected(null);
          void load();
        }}
      >
        {t("Обновить список")}
      </button>
      {loading ? (
        <p role="status">{t("Загрузка…")}</p>
      ) : selected ? (
        <form
          key={selected.service_type + selected.code + selected.version}
          onSubmit={save}
        >
          <h3>
            {t(labels[selected.service_type])} ·{" "}
            {t(
              vehicleLabels[selected.code as keyof typeof vehicleLabels] ??
                "Эконом",
            )}{" "}
            · v{selected.version}
          </h3>
          <fieldset disabled={saving} className="form-grid">
            {Object.entries(fields)
              .filter(([key]) =>
                selected.service_type === "equipment"
                  ? key !== "perKm" && key !== "maxKm"
                  : key !== "perHour",
              )
              .map(([key, label]) => (
                <label key={key}>
                  {t(label)}
                  <input
                    name={key}
                    type="number"
                    required
                    min={
                      key === "base" || key === "perKm" || key === "perHour"
                        ? 0
                        : key === "maxKm"
                          ? 0.01
                          : 1
                    }
                    step={
                      key === "maxKm" || key === "perKm" || key === "perHour"
                        ? "any"
                        : "1"
                    }
                    defaultValue={selected.rules[key]}
                  />
                </label>
              ))}
            <label>
              {t("Причина изменения")}
              <textarea name="reason" required minLength={5} maxLength={500} />
            </label>
          </fieldset>
          <button className="button" disabled={saving}>
            {t(saving ? "Сохранение…" : "Сохранить новую версию")}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={saving}
            onClick={() => setSelected(null)}
          >
            {t("Назад")}
          </button>
        </form>
      ) : (
        <>
          {!rows.length && <p>{t("Тарифы не найдены")}</p>}
          {rows
            .filter((r) => r.active)
            .map((r) => (
              <article
                className="card service-detail"
                key={r.service_type + ":" + r.code}
              >
                <h3>
                  {t(labels[r.service_type])} ·{" "}
                  {t(
                    vehicleLabels[r.code as keyof typeof vehicleLabels] ??
                      "Эконом",
                  )}
                </h3>
                <p>
                  {t("Версия")}: {r.version}
                </p>
                <dl>
                  {Object.entries(fields)
                    .filter(([key]) =>
                      r.service_type === "equipment"
                        ? key !== "perKm" && key !== "maxKm"
                        : key !== "perHour",
                    )
                    .map(([key, label]) => (
                      <div key={key}>
                        <dt>{t(label)}</dt>
                        <dd>
                          {new Intl.NumberFormat("ru-UZ").format(r.rules[key])}
                        </dd>
                      </div>
                    ))}
                </dl>
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    setSelected(r);
                    setNotice("");
                    setError("");
                  }}
                >
                  {t("Изменить тариф")}
                </button>
                <details>
                  <summary>{t("Предыдущие версии")}</summary>
                  {rows
                    .filter(
                      (h) =>
                        h.service_type === r.service_type &&
                        h.code === r.code &&
                        !h.active,
                    )
                    .map((h) => (
                      <div key={h.version}>
                        <b>v{h.version}</b> ·{" "}
                        {new Date(h.created_at).toLocaleString("ru-UZ", {
                          timeZone: "Asia/Tashkent",
                        })}
                        <dl>
                          {Object.entries(fields)
                            .filter(([key]) => key in h.rules)
                            .map(([key, label]) => (
                              <div key={key}>
                                <dt>{t(label)}</dt>
                                <dd>{h.rules[key]}</dd>
                              </div>
                            ))}
                        </dl>
                      </div>
                    ))}
                </details>
              </article>
            ))}
        </>
      )}
    </div>
  );
}
