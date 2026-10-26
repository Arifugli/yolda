// Server-only adapter. The browser uses authenticated /api/files, never these credentials.
function configuration() {
  const url = new URL(process.env.SUPABASE_URL ?? "");
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new Error("Supabase requires HTTPS");
  if (
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Use the Supabase project origin");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Supabase server key is required");
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "yolda-private";
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket))
    throw new Error("Invalid bucket name");
  return { origin: url.origin, key, bucket };
}
async function request(
  path: string,
  method = "GET",
  body?: Uint8Array | string,
  mime?: string,
) {
  const { origin, key } = configuration();
  const headers: Record<string, string> = { apikey: key };
  // New sb_secret keys are consumed by the gateway; legacy service_role JWTs use Bearer.
  if (!key.startsWith("sb_secret_")) headers.Authorization = "Bearer " + key;
  if (mime) headers["Content-Type"] = mime;
  const r = await fetch(origin + "/storage/v1/" + path, {
    method,
    headers,
    body: body as BodyInit | undefined,
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  return r;
}
const objectPath = (id: string) =>
  "object/" + configuration().bucket + "/" + encodeURIComponent(id);
export async function prepareSupabaseStorage() {
  const { bucket } = configuration();
  let r = await request("bucket/" + bucket);
  if (r.status === 404 || r.status === 400) {
    const created = await request(
      "bucket",
      "POST",
      JSON.stringify({
        id: bucket,
        name: bucket,
        public: false,
        file_size_limit: 5 * 1024 * 1024,
        allowed_mime_types: ["image/png", "image/jpeg", "image/webp"],
      }),
      "application/json",
    );
    // Another app instance may have created the bucket concurrently; always inspect it.
    if (!created.ok && ![400, 409].includes(created.status))
      throw new Error("Supabase bucket creation failed: " + created.status);
    r = await request("bucket/" + bucket);
  }
  if (!r.ok) throw new Error("Supabase bucket access failed: " + r.status);
  const data = await r.json();
  if (data.public !== false) throw new Error("Supabase bucket must be private");
}
export async function supabaseStore(id: string, bytes: Buffer, mime: string) {
  const r = await request(objectPath(id), "POST", bytes, mime);
  if (!r.ok) throw new Error("Supabase upload failed: " + r.status);
}
export async function supabaseLoad(id: string) {
  const r = await request(objectPath(id));
  if (!r.ok) throw new Error("Supabase download failed: " + r.status);
  return Buffer.from(await r.arrayBuffer());
}
export async function supabaseRemove(id: string) {
  const r = await request(
    "object/" + configuration().bucket,
    "DELETE",
    JSON.stringify({ prefixes: [id] }),
    "application/json",
  );
  if (!r.ok) throw new Error("Supabase cleanup failed: " + r.status);
}
