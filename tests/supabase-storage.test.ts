import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { prepareStorage, store, load } from "../lib/storage";
import { supabaseRemove } from "../lib/supabase-storage";
let exists = false,
  isPublic = false,
  unauthorized = false;
const objects = new Map<string, Buffer>();
const server = createServer(async (req, res) => {
  assert.equal(req.headers.apikey, "fixture-service-role");
  assert.equal(req.headers.authorization, "Bearer fixture-service-role");
  if (unauthorized) {
    res.writeHead(401).end();
    return;
  }
  if (req.url === "/storage/v1/bucket/yolda-private") {
    res
      .writeHead(exists ? 200 : 404, { "Content-Type": "application/json" })
      .end(JSON.stringify({ id: "yolda-private", public: isPublic }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  if (req.url === "/storage/v1/bucket" && req.method === "POST") {
    const data = JSON.parse(body.toString());
    assert.equal(data.public, false);
    exists = true;
    res.writeHead(200).end("{}");
    return;
  }
  if (req.method === "DELETE") {
    for (const key of JSON.parse(body.toString()).prefixes) objects.delete(key);
    res.writeHead(200).end("[]");
    return;
  }
  const id = decodeURIComponent(req.url!.split("/").at(-1)!);
  if (req.method === "POST") {
    objects.set(id, body);
    res.writeHead(200).end("{}");
    return;
  }
  if (!objects.has(id)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200).end(objects.get(id));
});
const names = [
  "STORAGE_DRIVER",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
];
const old = Object.fromEntries(names.map((k) => [k, process.env[k]]));
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.STORAGE_DRIVER = "supabase";
  process.env.SUPABASE_URL =
    "http://127.0.0.1:" + (server.address() as any).port;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-service-role";
  process.env.SUPABASE_STORAGE_BUCKET = "yolda-private";
});
after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  for (const n of names) {
    if (old[n] === undefined) delete process.env[n];
    else process.env[n] = old[n];
  }
});
test("Supabase REST adapter: private bucket, authenticated write/read/delete", async () => {
  await prepareStorage();
  assert.equal(exists, true);
  const bytes = Buffer.from("private-image-contract-fixture");
  await store("private-photo", bytes, "image/png");
  assert.deepEqual(await load("private-photo"), bytes);
  await supabaseRemove("private-photo");
  assert.equal(objects.size, 0);
});
test("Supabase: public bucket and failed authentication are rejected without local fallback", async () => {
  isPublic = true;
  await assert.rejects(prepareStorage(), /must be private/);
  isPublic = false;
  unauthorized = true;
  try {
    await assert.rejects(store("denied", Buffer.from("x"), "image/png"), /401/);
    await assert.rejects(load("denied"), /401/);
  } finally {
    unauthorized = false;
  }
});
