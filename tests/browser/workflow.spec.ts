import { type BrowserContext, type Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { pool } from "../../lib/db";
async function login(page: Page, i: number) {
  await page.goto("/");
  await page
    .getByLabel("Демонстрационные аккаунты")
    .selectOption("+99890000000" + i);
  await page.getByRole("button", { name: "Получить код", exact: true }).click();
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Куда отправимся сегодня?" }),
  ).toBeVisible();
}
async function post(ctx: BrowserContext, path: string, body: object) {
  const r = await ctx.request.post("/api/" + path, {
    data: body,
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
test.beforeAll(async ({ request }) => {
  await expect
    .poll(
      async () => {
        try {
          return (await request.get("/api/health")).status();
        } catch {
          return 0;
        }
      },
      { timeout: 30000 },
    )
    .toBe(200);
  for (let i = 0; i < 7; i++)
    await pool.query("DELETE FROM rate_limits WHERE key=ANY($1::text[])", [
      ["otp:+99890000000" + i, "login:+99890000000" + i],
    ]);
});
test("Полный пользовательский цикл в браузере, чат и отзыв", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    c = await browser.newContext();
  const sender = await a.newPage(),
    courier = await b.newPage(),
    recipient = await c.newPage();
  const errors: string[] = [];
  sender.on("pageerror", (e) => errors.push(e.message));
  await login(sender, 0);
  await login(courier, 1);
  await login(recipient, 2);
  await sender
    .getByRole("button", { name: /^Мои доставки/ })
    .first()
    .click();
  await sender
    .getByRole("button", {
      name: "Подробное отправление · пункты и постаматы",
      exact: true,
    })
    .click();
  await sender
    .getByLabel("Адрес", { exact: true })
    .nth(0)
    .fill("Тестовый дом 12");
  await sender
    .getByLabel("Адрес", { exact: true })
    .nth(1)
    .fill("Тестовый дом 24");
  await sender.getByRole("button", { name: "Далее", exact: true }).click();
  const description = "E2E · Посылка " + Date.now();
  await sender.getByLabel("Описание", { exact: true }).fill(description);
  await sender.getByRole("button", { name: "Далее", exact: true }).click();
  await sender.getByRole("button", { name: "Далее", exact: true }).click();
  await sender.getByRole("checkbox").nth(0).check();
  await sender.getByRole("checkbox").nth(1).check();
  await sender.getByRole("button", { name: "Создать черновик" }).click();
  await expect(
    sender.getByRole("heading", { name: description }),
  ).toBeVisible();
  const id = (
    await pool.query("SELECT id FROM shipments WHERE data->>'description'=$1", [
      description,
    ])
  ).rows[0].id;
  await sender.getByRole("button", { name: "Оплатить (демо)" }).click();
  await sender
    .getByRole("button", { name: "Опубликовать", exact: true })
    .click();
  await expect(
    sender.getByText("Заказ опубликован", { exact: true }),
  ).toBeVisible();
  const courierUser = (await b.request.get("/api/me")).json();
  const courierId = (await courierUser).user.id;
  await post(b, `shipments/${id}/offer`, {});
  await expect(
    sender.getByRole("button", { name: "Выбрать курьера", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await sender
    .getByRole("button", { name: "Выбрать курьера", exact: true })
    .click();
  await expect(
    sender.getByText("Курьер назначен", { exact: true }).first(),
  ).toBeVisible();
  await courier
    .getByRole("button", { name: /^Мои доставки/ })
    .first()
    .click();
  await courier.getByRole("button", { name: /Доставляю/ }).click();
  await courier.reload();
  await courier
    .getByRole("button", { name: /^Мои доставки/ })
    .first()
    .click();
  await courier.getByRole("button", { name: /Доставляю/ }).click();
  await courier
    .getByRole("button")
    .filter({ has: courier.getByRole("heading", { name: description }) })
    .click();
  await courier.getByRole("button", { name: "Прибыл на забор" }).click();
  await expect(
    sender.getByRole("button", { name: "Передать посылку", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await sender
    .getByRole("button", { name: "Передать посылку", exact: true })
    .click();
  const pickup = await sender.locator(".handover-code strong").innerText();
  await courier.getByLabel("Одноразовый код отправителя").fill(pickup);
  await courier
    .getByRole("button", { name: "Принять посылку", exact: true })
    .click();
  await courier
    .getByRole("button", { name: "Посылка в пути", exact: true })
    .click();
  await courier
    .getByRole("button", { name: "Прибыл в точку назначения", exact: true })
    .click();
  await courier
    .getByRole("button", { name: "Передать получателю", exact: true })
    .click();
  await recipient
    .getByRole("button", { name: /^Мои доставки/ })
    .first()
    .click();
  await recipient.getByRole("button", { name: /Получаю/ }).click();
  await recipient
    .getByRole("button")
    .filter({ has: recipient.getByRole("heading", { name: description }) })
    .click();
  await recipient
    .getByRole("button", { name: "Код получателя", exact: true })
    .click();
  const delivery = await recipient.locator(".handover-code strong").innerText();
  await courier.getByLabel("Одноразовый код получателя").fill(delivery);
  await courier
    .getByRole("button", { name: "Подтвердить передачу", exact: true })
    .click();
  await expect(
    recipient.getByRole("button", {
      name: "Подтвердить получение",
      exact: true,
    }),
  ).toBeVisible({ timeout: 10000 });
  await recipient
    .getByRole("button", { name: "Подтвердить получение", exact: true })
    .click();
  await expect(
    recipient.getByText("Доставка завершена подтверждением получателя.", {
      exact: false,
    }),
  ).toBeVisible();
  await sender
    .getByRole("textbox", { name: "Текст сообщения" })
    .fill("Спасибо за доставку");
  await sender.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(
    courier.getByText("Спасибо за доставку", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await recipient
    .getByLabel("Комментарий", { exact: true })
    .fill("Все отлично");
  await recipient
    .getByRole("button", { name: "Оставить отзыв", exact: true })
    .click();
  await expect
    .poll(async () => {
      return (
        await pool.query(
          "SELECT stars FROM reviews WHERE shipment_id=$1 AND target_id=$2",
          [id, courierId],
        )
      ).rows[0]?.stars;
    })
    .toBe(5);
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
  await c.close();
});
test("Адаптивный интерфейс и отказ в доступе через HTTP", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const p = await ctx.newPage();
  await login(p, 3);
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await p.screenshot({ path: "artifacts/mobile.png", fullPage: true });
  await p.getByRole("button", { name: "Профиль", exact: true }).last().click();
  await expect(
    p.getByRole("heading", { name: "Профиль", exact: true }),
  ).toBeVisible();
  const id = (
    await pool.query(
      "SELECT id FROM shipments WHERE data->>'description' LIKE 'E2E%' ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0].id;
  expect((await ctx.request.get("/api/shipments/" + id)).status()).toBe(403);
  await ctx.close();
});
test("Фото приватно до назначения аватаром, а поддельный MIME отклоняется", async ({
  browser,
}) => {
  const owner = await browser.newContext(),
    other = await browser.newContext();
  const a = await owner.newPage(),
    b = await other.newPage();
  await login(a, 6);
  await login(b, 3);
  const sharp = (await import("sharp")).default;
  const photo = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#176e58" },
  })
    .png()
    .toBuffer();
  const uploaded = await owner.request.post("/api/files", {
    multipart: {
      file: { name: "demo.png", mimeType: "image/png", buffer: photo },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const file = (await uploaded.json()).id;
  expect((await owner.request.get("/api/files/" + file)).status()).toBe(200);
  expect((await other.request.get("/api/files/" + file)).status()).toBe(403);
  const me = await (await owner.request.get("/api/me")).json();
  await post(owner, "profile", {
    transport: "walk",
    city: "Андижан",
    accepting: true,
    language: "ru",
    notifications: true,
    avatarId: file,
  });
  expect((await other.request.get("/api/avatars/" + me.user.id)).status()).toBe(
    200,
  );
  const bad = await owner.request.post("/api/files", {
    multipart: {
      file: {
        name: "evil.png",
        mimeType: "image/png",
        buffer: Buffer.from("<script>alert(1)</script>"),
      },
    },
  });
  expect(bad.status()).toBe(400);
  await owner.close();
  await other.close();
});
test("Название меняется для интерфейса, метаданных и PWA", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, 4);
  const original = (await (await ctx.request.get("/api/config")).json())
    .settings;
  try {
    await post(ctx, "admin.settings", {
      ...original,
      name: "Yolda Brand Test",
    });
    const config = await (await ctx.request.get("/api/config")).json();
    expect(config.settings.name).toBe("Yolda Brand Test");
    await p.reload();
    await expect(
      p.getByRole("link", { name: "Yolda Brand Test", exact: true }),
    ).toBeVisible();
    await expect(p).toHaveTitle("Yolda Brand Test");
    const manifest = await (
      await ctx.request.get("/manifest.webmanifest")
    ).json();
    expect(manifest.name).toBe("Yolda Brand Test");
  } finally {
    await post(ctx, "admin.settings", original);
    await ctx.close();
  }
});
test("Повтор после потери ответа не создает второе отправление", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, 0);
  await p
    .getByRole("button", { name: /^Мои доставки/ })
    .first()
    .click();
  await p
    .getByRole("button", {
      name: "Подробное отправление · пункты и постаматы",
      exact: true,
    })
    .click();
  await p.getByLabel("Адрес", { exact: true }).nth(0).fill("Дом 12");
  await p.getByLabel("Адрес", { exact: true }).nth(1).fill("Дом 24");
  await p.getByRole("button", { name: "Далее", exact: true }).click();
  const description = "E2E · Network " + Date.now();
  await p.getByLabel("Описание", { exact: true }).fill(description);
  await p.getByRole("button", { name: "Далее", exact: true }).click();
  await p.getByRole("button", { name: "Далее", exact: true }).click();
  await p.getByRole("checkbox").nth(0).check();
  await p.getByRole("checkbox").nth(1).check();
  let lost = false;
  const keys: string[] = [];
  await p.route("**/api/shipments", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    keys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    if (!lost) {
      lost = true;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await p.getByRole("button", { name: "Создать черновик" }).click();
  await expect(p.getByRole("alert")).toBeVisible();
  await p.getByRole("button", { name: "Создать черновик" }).click();
  await expect(p.getByRole("heading", { name: description })).toBeVisible();
  expect(keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int n FROM shipments WHERE data->>'description'=$1",
        [description],
      )
    ).rows[0].n,
  ).toBe(1);
  await ctx.close();
});
