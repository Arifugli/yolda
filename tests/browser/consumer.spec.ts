import { type BrowserContext, type Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { pool } from "../../lib/db";
const prefix = "consumer-" + Date.now();
const taxiIds: string[] = [];
test.use({ actionTimeout: 15000 });
async function locations(context: BrowserContext, failSearch = false) {
  await context.route("**/api/places?**", async (route) => {
    const url = new URL(route.request().url());
    if (failSearch && url.searchParams.has("q")) {
      await route.fulfill({
        status: 503,
        json: {
          error: "Поиск адресов временно недоступен. Выберите точку на карте.",
        },
      });
      return;
    }
    await route.fulfill({
      json: [
        url.searchParams.has("q")
          ? {
              lat: 40.4,
              lng: 71.8,
              address: "Сохибкорлар 18А",
              city: "Фергана",
            }
          : {
              lat: Number(url.searchParams.get("lat")),
              lng: Number(url.searchParams.get("lng")),
              address: "Юксалиш 109А",
              city: "Фергана",
            },
      ],
    });
  });
}
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
async function destination(page: Page, delivery = false) {
  await page
    .getByRole("button", {
      name: delivery ? "Выбрать адрес доставки" : "Выбрать пункт назначения",
      exact: true,
    })
    .click();
  await page
    .getByRole("textbox", { name: "Поиск адреса", exact: true })
    .fill("Сохибкорлар 18А");
  await page.getByRole("button", { name: "Найти адрес", exact: true }).click();
  await page.locator(".address-results button").first().click();
}
async function post(ctx: BrowserContext, path: string, body: object) {
  const r = await ctx.request.post("/api/" + path, {
    data: body,
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
test.beforeEach(async () => {
  for (let i = 0; i < 4; i++)
    await pool.query("DELETE FROM rate_limits WHERE key=$1", [
      "otp:+99890000000" + i,
    ]);
});
test.afterAll(async () => {
  await pool.query("DELETE FROM service_requests WHERE id=ANY($1::uuid[])", [
    taxiIds,
  ]);
  const ids = (
    await pool.query(
      "SELECT id FROM shipments WHERE data->>'description' LIKE $1",
      [prefix + "%"],
    )
  ).rows.map((r) => r.id);
  for (const table of [
    "files",
    "point_requests",
    "device_events",
    "reservations",
    "payouts",
    "refunds",
    "payments",
    "handovers",
    "handover_codes",
    "tracking_events",
    "reviews",
    "disputes",
    "notifications",
    "assignments",
    "courier_offers",
    "delivery_legs",
    "locations",
    "parcels",
    "messages",
    "conversations",
  ])
    await pool.query(`DELETE FROM ${table} WHERE shipment_id=ANY($1::uuid[])`, [
      ids,
    ]);
  await pool.query("DELETE FROM shipments WHERE id=ANY($1::uuid[])", [ids]);
});
test("Мобильная главная: четыре настоящие услуги без водительских настроек и горизонтальной прокрутки", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation: { latitude: 40.386, longitude: 71.786, accuracy: 10 },
  });
  await locations(ctx);
  const page = await ctx.newPage();
  try {
    await login(page, 0);
    for (const name of ["Такси", "Доставка", "Грузоперевозки", "Спецтехника"])
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    await expect(page.locator(".taxi-availability")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Yolda", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "artifacts/consumer-home-mobile.png",
      fullPage: true,
    });
  } finally {
    await ctx.close();
  }
});
test("Доставка с карты оформляется одним нажатием и проходит полный цикл тремя аккаунтами", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const a = await browser.newContext({
      viewport: { width: 390, height: 844 },
      permissions: ["geolocation"],
      geolocation: { latitude: 40.386, longitude: 71.786, accuracy: 10 },
    }),
    b = await browser.newContext(),
    c = await browser.newContext();
  await locations(a);
  const sender = await a.newPage(),
    courier = await b.newPage(),
    receiver = await c.newPage();
  try {
    await login(sender, 0);
    await login(courier, 1);
    await login(receiver, 2);
    await sender.getByRole("button", { name: "Доставка", exact: true }).click();
    await expect(
      sender.getByRole("button", {
        name: "Изменить адрес отправления",
        exact: true,
      }),
    ).toContainText("Юксалиш 109А");
    await destination(sender, true);
    await sender
      .getByLabel("Телефон получателя", { exact: true })
      .fill("+998900000002");
    await sender
      .getByLabel("Что отправляем?", { exact: true })
      .fill(prefix + "-delivery");
    await sender
      .getByRole("checkbox", {
        name: "Посылка упакована, запрещённых предметов нет",
        exact: true,
      })
      .check();
    await expect(
      sender.getByRole("button", { name: /Заказать доставку/ }),
    ).toBeEnabled();
    await sender.screenshot({
      path: "artifacts/delivery-map-mobile.png",
      fullPage: true,
    });
    await sender.getByRole("button", { name: /Заказать доставку/ }).click();
    await expect(
      sender.getByRole("heading", { name: "Ищем курьера", exact: true }),
    ).toBeVisible();
    const id = (
      await pool.query(
        "SELECT id FROM shipments WHERE data->>'description'=$1",
        [prefix + "-delivery"],
      )
    ).rows[0].id;
    await post(b, `shipments/${id}/offer`, {});
    await courier
      .getByRole("button", { name: /^Мои доставки/ })
      .first()
      .click();
    await courier.getByRole("button", { name: /Доставляю/ }).click();
    await courier
      .getByRole("button")
      .filter({
        has: courier.getByRole("heading", {
          name: prefix + "-delivery",
          exact: true,
        }),
      })
      .click();
    await courier
      .getByRole("button", { name: "Прибыл на забор", exact: true })
      .click();
    await sender
      .getByRole("button", { name: "Код передачи курьеру", exact: true })
      .click();
    await courier
      .getByLabel("Одноразовый код отправителя")
      .fill(await sender.locator(".booking-code strong").innerText());
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
    await receiver
      .getByRole("button", { name: /^Мои доставки/ })
      .first()
      .click();
    await receiver.getByRole("button", { name: /Получаю/ }).click();
    await receiver
      .getByRole("button")
      .filter({
        has: receiver.getByRole("heading", {
          name: prefix + "-delivery",
          exact: true,
        }),
      })
      .click();
    await receiver
      .getByRole("button", { name: "Код получения посылки", exact: true })
      .click();
    await courier
      .getByLabel("Одноразовый код получателя")
      .fill(await receiver.locator(".booking-code strong").innerText());
    await courier
      .getByRole("button", { name: "Подтвердить передачу", exact: true })
      .click();
    await receiver
      .getByRole("button", { name: "Подтвердить получение", exact: true })
      .click();
    await expect(
      receiver.getByRole("heading", {
        name: "Посылка доставлена",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await a.close();
    await b.close();
    await c.close();
  }
});
test("Отказ GPS и ошибка поиска не блокируют выбор адресов на карте", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await locations(ctx, true);
  const page = await ctx.newPage();
  try {
    await login(page, 0);
    await page.getByRole("button", { name: "Такси", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /Заказать такси/ }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Изменить место подачи", exact: true })
      .click();
    await expect(page.locator(".booking-map")).toHaveClass(/leaflet-container/);
    await page.locator(".booking-map").click({ position: { x: 220, y: 350 } });
    await page
      .getByRole("button", { name: "Подтвердить адрес", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Выбрать пункт назначения", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Поиск адреса", exact: true })
      .fill("Несуществующая улица");
    await page
      .getByRole("button", { name: "Найти адрес", exact: true })
      .click();
    await expect(page.locator(".address-results [role=alert]")).toContainText(
      "Поиск адресов временно недоступен",
    );
    await page
      .getByRole("button", { name: "Выбрать на карте", exact: true })
      .click();
    await page.locator(".booking-map").click({ position: { x: 280, y: 300 } });
    await page
      .getByRole("button", { name: "Подтвердить адрес", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /Заказать такси/ }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await expect(
      page.getByRole("textbox", { name: /Широта|Долгота/ }),
    ).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test("Повтор такси после потери ответа сохраняет тело запроса и создаёт одну поездку", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation: { latitude: 40.386, longitude: 71.786, accuracy: 10 },
  });
  await locations(ctx);
  const page = await ctx.newPage();
  try {
    await login(page, 0);
    await page.getByRole("button", { name: "Такси", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Изменить место подачи", exact: true }),
    ).toContainText("Юксалиш 109А");
    await destination(page);
    const keys: string[] = [],
      bodies: string[] = [];
    let first = true;
    await page.route("**/api/mobility", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      keys.push(route.request().headers()["idempotency-key"]);
      bodies.push(route.request().postData()!);
      const response = await route.fetch();
      if (response.ok()) {
        const r = await response.json();
        if (!taxiIds.includes(r.id)) taxiIds.push(r.id);
      }
      if (first) {
        first = false;
        await route.abort("failed");
      } else await route.fulfill({ response });
    });
    await page.getByRole("button", { name: /Заказать такси/ }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.getByRole("button", { name: /Заказать такси/ }).click();
    await expect(
      page.getByRole("heading", { name: "Ищем водителя", exact: true }),
    ).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(bodies[0]).toBe(bodies[1]);
    expect(taxiIds).toHaveLength(1);
  } finally {
    await ctx.close();
  }
});
