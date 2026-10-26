import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../lib/db";
import {
  prepareSupabaseStorage,
  supabaseLoad,
  supabaseRemove,
  supabaseStore,
} from "../lib/supabase-storage";
if (
  process.env.STORAGE_DRIVER !== "supabase" ||
  process.env.DATABASE_SSL !== "true"
)
  throw new Error("Select Supabase storage and verified database TLS first");
const id = "deployment-check-" + randomUUID();
let uploaded = false;
try {
  await pool.query("SELECT 1");
  const tables = await pool.query(
    "SELECT relname FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='public' AND relname IN ('users','service_requests','service_vehicles') AND relrowsecurity",
  );
  assert.equal(
    tables.rowCount,
    3,
    "Apply all migrations and RLS before deployment",
  );
  await prepareSupabaseStorage();
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cO2sAAAAASUVORK5CYII=",
    "base64",
  );
  await supabaseStore(id, bytes, "image/png");
  uploaded = true;
  assert.deepEqual(await supabaseLoad(id), bytes);
  console.log(
    "Supabase database TLS, migrated tables, RLS and private storage round-trip: passed",
  );
} finally {
  try {
    if (uploaded) await supabaseRemove(id);
  } finally {
    await pool.end();
  }
}
