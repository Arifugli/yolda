import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { geocode } from "../lib/geocoding";
afterEach(() => mock.restoreAll());
test("Explicit address search returns real provider coordinates, normalizes the city and caches results", async () => {
  let calls = 0;
  mock.method(globalThis, "fetch", async (input: any, init: any) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.hostname, "nominatim.openstreetmap.org");
    assert.equal(url.searchParams.get("countrycodes"), "uz");
    assert.match(init.headers["User-Agent"], /^Yolda/);
    return new Response(
      JSON.stringify([
        {
          lat: "40.386",
          lon: "71.786",
          address: { road: "Юксалиш", house_number: "109А", city: "Farg‘ona" },
        },
      ]),
    );
  });
  const params = new URLSearchParams({
    q: "Юксалиш 109А " + randomUUID(),
    lat: "40.386",
    lng: "71.786",
  });
  const places = await geocode(params);
  assert.equal(places[0].address, "Юксалиш 109А");
  assert.equal(places[0].city, "Фергана");
  assert.equal(places[0].lat, 40.386);
  await geocode(params);
  assert.equal(calls, 1);
});
test("Invalid search input is rejected before a provider call and provider failures remain recoverable", async () => {
  const fetch = mock.method(
    globalThis,
    "fetch",
    async () => new Response("{}", { status: 503 }),
  );
  await assert.rejects(geocode(new URLSearchParams({ q: "a" })));
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(
    geocode(new URLSearchParams({ q: randomUUID() })),
    /Выберите точку на карте/,
  );
});
test("Reverse lookup returns no fabricated address for malformed provider data", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify({ error: "Unable to geocode" })),
  );
  assert.deepEqual(
    await geocode(
      new URLSearchParams({
        mode: "reverse",
        lat: "40.39999",
        lng: "71.78888",
      }),
    ),
    [],
  );
});
