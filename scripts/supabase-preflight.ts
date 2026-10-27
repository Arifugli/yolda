import { pool } from "../lib/db";
import { readFile, readdir } from "node:fs/promises";
if (
  process.env.STORAGE_DRIVER !== "supabase" ||
  process.env.DATABASE_SSL !== "true"
)
  throw new Error(
    "Supabase setup requires private Supabase storage and verified PostgreSQL TLS",
  );
if (!/^[0-9a-f]{64}$/i.test(process.env.APP_ENCRYPTION_KEY ?? ""))
  throw new Error(
    "Set a persistent 64-character hex APP_ENCRYPTION_KEY on the app host",
  );
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.DEMO_ACCESS_PASSWORD)
  throw new Error(
    "Set the server storage key and shared demo password on the app host",
  );
try {
  const names = new Set<string>();
  for (const f of (await readdir("migrations")).filter((n) =>
    n.endsWith(".sql"),
  )) {
    const sql = await readFile("migrations/" + f, "utf8");
    for (const m of sql.matchAll(
      /(?:CREATE TABLE(?: IF NOT EXISTS)?\s+|ALTER TABLE [a-z_]+ RENAME TO\s+)([a-z_]+)/g,
    ))
      names.add(m[1]);
  }
  const existing = (
    await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])",
      [[...names]],
    )
  ).rows;
  if (existing.length) {
    const own = (
      await pool.query(
        "SELECT to_regclass('public.schema_migrations') AS migrations",
      )
    ).rows[0].migrations;
    if (!own)
      throw new Error(
        "This project has colliding public tables. Use a separate Supabase project; nothing was migrated.",
      );
    const signature = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name=ANY($1::text[])",
      [["public_id", "phone_verified", "identity", "dob"]],
    );
    const first = await pool.query(
      "SELECT 1 FROM public.schema_migrations WHERE name='001.sql'",
    );
    if (signature.rowCount !== 4 || !first.rowCount)
      throw new Error(
        "Existing database is not an initialized Yolda schema; refusing to modify it",
      );
  }
  console.log(
    "Supabase database preflight passed; server secrets are configured (values not printed)",
  );
} finally {
  await pool.end();
}
