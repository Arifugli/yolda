import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
test("Hosted demo requires a shared password, API access is protected and health checks remain available", () => {
  const names = [
      "STORAGE_DRIVER",
      "APP_MODE",
      "DEMO_ACCESS_USER",
      "DEMO_ACCESS_PASSWORD",
    ],
    old = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    process.env.STORAGE_DRIVER = "supabase";
    process.env.APP_MODE = "demo";
    delete process.env.DEMO_ACCESS_PASSWORD;
    assert.equal(proxy(new NextRequest("https://example.test/")).status, 503);
    assert.equal(
      proxy(new NextRequest("https://example.test/api/health")).status,
      200,
    );
    process.env.DEMO_ACCESS_USER = "demo";
    process.env.DEMO_ACCESS_PASSWORD = "test-only-not-a-deployment-password";
    assert.equal(
      proxy(new NextRequest("https://example.test/api/mobility")).status,
      401,
    );
    assert.equal(
      proxy(
        new NextRequest("https://example.test/", {
          headers: {
            authorization:
              "Basic " +
              Buffer.from("demo:" + process.env.DEMO_ACCESS_PASSWORD).toString(
                "base64",
              ),
          },
        }),
      ).status,
      200,
    );
  } finally {
    for (const n of names) {
      if (old[n] === undefined) delete process.env[n];
      else process.env[n] = old[n];
    }
  }
});
