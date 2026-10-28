import { test, expect } from "./fixtures";
import { pool } from "../../lib/db";
test("Админка: мобильное изменение тарифа, история и конфликт версий", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    page = await ctx.newPage();
  const original = (
    await pool.query(
      "SELECT * FROM order_tariffs WHERE service_type='ride' AND code='economy' AND active",
    )
  ).rows[0];
  const reason = "E2E-tariff-" + Date.now();
  try {
    await pool.query("DELETE FROM rate_limits WHERE key=ANY($1::text[])", [
      ["otp:+998900000004", "login:+998900000004"],
    ]);
    await page.goto("/");
    await page
      .getByLabel("Демонстрационные аккаунты")
      .selectOption("+998900000004");
    await page
      .getByRole("button", { name: "Получить код", exact: true })
      .click();
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page
      .getByRole("button", { name: "Открыть профиль", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Администрирование", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Тарифы машин", exact: true })
      .click();
    const card = page.locator(".tariff-editor article").filter({
      has: page.getByRole("heading", { name: "Такси · Эконом", exact: true }),
    });
    await card
      .getByRole("button", { name: "Изменить тариф", exact: true })
      .click();
    await page
      .getByLabel("Базовая стоимость, сум", { exact: true })
      .fill(String(original.rules.base + 1000));
    await page.getByLabel("Причина изменения", { exact: true }).fill(reason);
    await page
      .getByRole("button", { name: "Сохранить новую версию", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Новая версия тарифа сохранена" }),
    ).toContainText("Новая версия тарифа сохранена");
    await expect(card).toContainText("Версия: " + (original.version + 1));
    await card.locator("summary").click();
    await expect(card.locator("details")).toContainText("v" + original.version);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: "artifacts/admin-tariffs-mobile.png",
      fullPage: true,
    });
    const stale = await ctx.request.post("/api/admin.tariff", {
      headers: { "Idempotency-Key": crypto.randomUUID() },
      data: {
        serviceType: "ride",
        code: "economy",
        expectedVersion: original.version,
        rules: original.rules,
        reason,
      },
    });
    expect(stale.status()).toBe(409);
    expect(
      (
        await pool.query(
          "SELECT detail FROM audit_logs WHERE action='tariff.update' AND detail->>'reason'=$1",
          [reason],
        )
      ).rowCount,
    ).toBe(1);
  } finally {
    await ctx.close();
    await pool.query(
      "DELETE FROM order_tariffs WHERE service_type='ride' AND code='economy' AND version>$1",
      [original.version],
    );
    await pool.query(
      "UPDATE order_tariffs SET active=true WHERE service_type='ride' AND code='economy' AND version=$1",
      [original.version],
    );
    await pool.query(
      "DELETE FROM audit_logs WHERE action='tariff.update' AND detail->>'reason'=$1",
      [reason],
    );
  }
});
