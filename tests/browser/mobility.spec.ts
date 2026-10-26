import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { pool } from "../../lib/db";
const prefix = "E2E-services-" + Date.now();
test.use({ actionTimeout: 15000 });
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
async function services(page: Page, kind = "Такси") {
  await page
    .getByRole("button", { name: "Услуги", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: kind, exact: true }).click();
}
async function addVehicle(page: Page, kind: string, name: string) {
  await page.getByRole("button", { name: "Мои машины", exact: true }).click();
  await page.getByLabel("Тип машины", { exact: true }).selectOption(kind);
  await page.getByLabel("Марка и модель", { exact: true }).fill(name);
  await page.getByLabel("Госномер", { exact: true }).fill("TEST-000");
  if (kind === "crane") {
    await page
      .getByLabel("Грузоподъёмность крана, тонн", { exact: true })
      .fill("25");
    await page.getByLabel("Вылет стрелы, метров", { exact: true }).fill("30");
  }
  await page
    .getByRole("checkbox", { name: /Подтверждаю право управления/ })
    .check();
  await page
    .getByRole("button", { name: "Сохранить машину", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: new RegExp(name) }),
  ).toBeVisible();
}
async function startAndFinish(customer: Page, driver: Page, taxi: boolean) {
  await driver.getByRole("button", { name: "Я прибыл", exact: true }).click();
  await customer
    .getByRole("button", { name: "Получить код начала", exact: true })
    .click({ timeout: 15000 });
  const code = await customer.locator(".handover-code strong").innerText();
  await driver
    .getByLabel("Код начала от заказчика", { exact: true })
    .fill(code);
  await driver
    .getByRole("button", {
      name: taxi ? "Начать поездку" : "Начать работу",
      exact: true,
    })
    .click();
  await driver
    .getByRole("button", { name: "Сообщить о выполнении", exact: true })
    .click({ timeout: 15000 });
  await customer
    .getByRole("button", { name: "Подтвердить выполнение", exact: true })
    .click({ timeout: 15000 });
  await expect(customer.locator(".service-detail .pill")).toHaveText(
    "Завершён",
    { timeout: 15000 },
  );
}
test.beforeEach(async () => {
  for (let i = 0; i < 3; i++)
    await pool.query("DELETE FROM rate_limits WHERE key=$1", [
      "otp:+99890000000" + i,
    ]);
});
test.afterAll(async () => {
  const ids = (
    await pool.query(
      "SELECT id FROM service_requests WHERE data->>'description' LIKE $1",
      [prefix + "%"],
    )
  ).rows.map((r) => r.id);
  await pool.query("DELETE FROM service_requests WHERE id=ANY($1::uuid[])", [
    ids,
  ]);
  await pool.query(
    "DELETE FROM taxi_presence WHERE vehicle_id IN(SELECT id FROM service_vehicles WHERE data->>'name' LIKE $1)",
    [prefix + "%"],
  );
  await pool.query("DELETE FROM service_vehicles WHERE data->>'name' LIKE $1", [
    prefix + "%",
  ]);
});
test("Такси в браузере: карта, геопозиция водителя, автоподбор и полный цикл поездки", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const a = await browser.newContext(),
    b = await browser.newContext({
      permissions: ["geolocation"],
      geolocation: { latitude: 40.386, longitude: 71.787, accuracy: 10 },
    });
  const customer = await a.newPage(),
    driver = await b.newPage();
  const errors: string[] = [];
  customer.on("pageerror", (e) => errors.push(e.message));
  driver.on("pageerror", (e) => errors.push(e.message));
  try {
    await login(customer, 0);
    await login(driver, 1);
    await services(driver);
    await addVehicle(driver, "sedan", prefix + "-sedan");
    const availability = driver.locator(".taxi-availability");
    await availability.locator("summary").click();
    await driver
      .getByLabel("Машина для такси", { exact: true })
      .selectOption({ label: prefix + "-sedan · TEST-000" });
    await driver
      .getByRole("checkbox", { name: /Разрешаю передавать текущую геопозицию/ })
      .check();
    await driver
      .getByRole("button", { name: "Выйти на линию", exact: true })
      .click();
    await expect(availability.locator("summary")).toContainText("На линии", {
      timeout: 15000,
    });
    await services(customer);
    await customer
      .getByRole("button", { name: "Заказать поездку", exact: true })
      .click();
    await customer
      .getByLabel("Откуда", { exact: true })
      .fill("Тестовый дом 12");
    await customer
      .getByLabel("Куда", { exact: true })
      .fill("Тестовый вокзал 24");
    await customer
      .getByLabel("Пожелания к поездке", { exact: true })
      .fill(prefix + "-taxi");
    await customer.getByText("Координаты точек", { exact: true }).click();
    await customer.getByLabel("origin lat", { exact: true }).fill("40.386");
    await customer.getByLabel("origin lng", { exact: true }).fill("71.786");
    await customer.getByLabel("destination lat", { exact: true }).fill("40.4");
    await customer.getByLabel("destination lng", { exact: true }).fill("71.8");
    await customer
      .getByRole("button", { name: "Рассчитать стоимость", exact: true })
      .click();
    await expect(customer.getByRole("status")).toContainText(
      "Стоимость поездки",
    );
    await customer
      .getByRole("checkbox", { name: /Согласую безопасную посадку/ })
      .check();
    await customer
      .getByRole("button", { name: "Опубликовать заявку", exact: true })
      .click();
    await expect(customer.locator(".service-detail .pill")).toHaveText(
      "Ожидаем ответа водителя",
      { timeout: 15000 },
    );
    await driver
      .getByRole("button", { name: "Открыть поездку", exact: true })
      .click({ timeout: 15000 });
    await driver
      .getByRole("button", { name: "Принять поездку", exact: true })
      .click();
    await startAndFinish(customer, driver, true);
    await driver
      .getByRole("button", { name: "Уйти с линии", exact: true })
      .click();
    await customer.screenshot({
      path: "artifacts/taxi-completed.png",
      fullPage: true,
    });
    assertNoErrors(errors);
  } finally {
    await a.close();
    await b.close();
  }
});
test("Спецтехника в браузере: кран, предложение цены и подтверждение выполнения", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const a = await browser.newContext(),
    b = await browser.newContext(),
    customer = await a.newPage(),
    driver = await b.newPage();
  try {
    await login(customer, 0);
    await login(driver, 1);
    await services(driver, "Спецтехника");
    await addVehicle(driver, "crane", prefix + "-crane");
    await services(customer, "Спецтехника");
    await customer
      .getByRole("button", { name: "Создать заявку", exact: true })
      .click();
    await customer
      .getByLabel("Адрес работ", { exact: true })
      .fill("Стройплощадка 12");
    await customer
      .getByLabel("Масса подъёма, тонн", { exact: true })
      .fill("10");
    await customer
      .getByLabel("Вылет стрелы, метров", { exact: true })
      .fill("20");
    await customer
      .getByLabel("Описание груза или работ, размеры, условия доступа", {
        exact: true,
      })
      .fill(prefix + "-crane-job");
    await customer
      .getByRole("checkbox", { name: /Согласую безопасную посадку/ })
      .check();
    await customer
      .getByRole("button", { name: "Опубликовать заявку", exact: true })
      .click();
    await expect(customer.locator(".service-detail .pill")).toHaveText(
      "Поиск исполнителя",
    );
    await driver
      .getByRole("button", { name: "Найти работу", exact: true })
      .click();
    await driver
      .locator(".service-card")
      .filter({ hasText: "Автокран" })
      .first()
      .click();
    await driver
      .getByLabel("Предложение за весь заказ, сум", { exact: true })
      .fill("800000");
    await driver
      .getByRole("button", { name: "Откликнуться", exact: true })
      .click();
    await customer
      .getByRole("button", { name: "Выбрать исполнителя", exact: true })
      .click({ timeout: 15000 });
    await startAndFinish(customer, driver, false);
  } finally {
    await a.close();
    await b.close();
  }
});
test("Мобильные услуги не выходят за ширину экрана", async ({ browser }) => {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    page = await context.newPage();
  try {
    await login(page, 2);
    await services(page, "Грузоперевозки");
    await page
      .getByRole("button", { name: "Создать заявку", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Новая заявка", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "artifacts/mobility-mobile.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
function assertNoErrors(errors: string[]) {
  expect(errors).toEqual([]);
}
