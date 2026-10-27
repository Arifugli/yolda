import { test, after } from "node:test";
import assert from "node:assert/strict";
import { sendLoginCode, smsMode } from "../lib/sms";
const names = [
  "SMS_PROVIDER",
  "ESKIZ_TOKEN",
  "ESKIZ_TEMPLATE",
  "APP_MODE",
  "DEPLOYMENT_ENV",
];
const original = Object.fromEntries(names.map((k) => [k, process.env[k]]));
after(() => {
  for (const k of names) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});
test("SMS: demo explicit; configured provider accepts without exposing code; provider errors sanitized", async () => {
  process.env.APP_MODE = "demo";
  process.env.DEPLOYMENT_ENV = "development";
  delete process.env.SMS_PROVIDER;
  assert.equal(smsMode(), "demo");
  process.env.DEPLOYMENT_ENV = "production";
  assert.throws(() => smsMode());
  process.env.SMS_PROVIDER = "eskiz";
  delete process.env.ESKIZ_TOKEN;
  assert.throws(() => smsMode());
  process.env.ESKIZ_TOKEN = "test-token";
  process.env.ESKIZ_TEMPLATE = "Yolda: {code}";
  let calls = 0;
  const fake: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://notify.eskiz.uz/api/message/sms/send");
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer test-token",
    );
    assert.equal(
      (init?.body as URLSearchParams).get("message"),
      "Yolda: 123456",
    );
    return Response.json({ status: "waiting" });
  };
  assert.deepEqual(await sendLoginCode("+998901234567", "123456", fake), {
    provider: "eskiz",
  });
  assert.equal(calls, 1);
  await assert.rejects(
    sendLoginCode("+998901234567", "123456", async () =>
      Response.json({ error: "test-token" }, { status: 401 }),
    ),
    /Не удалось отправить SMS/,
  );
  await assert.rejects(
    sendLoginCode("+998901234567", "123456", async () =>
      Response.json({ status: "error" }),
    ),
    /Не удалось отправить SMS/,
  );
});
