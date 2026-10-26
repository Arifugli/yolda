import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCACertificates, type ConnectionOptions } from "node:tls";
import type { PoolConfig } from "pg";

const localDatabase = "postgres://yolda:yolda_local@localhost:5432/yolda";
const isSupabase = (hostname: string) =>
  /^db\.[a-z0-9]+\.supabase\.co$/.test(hostname) ||
  hostname === "pooler.supabase.com" ||
  hostname.endsWith(".pooler.supabase.com");

export function postgresConnectionOptions(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Pick<PoolConfig, "connectionString" | "ssl"> {
  const connectionString = environment.DATABASE_URL ?? localDatabase;
  if (environment.DATABASE_SSL !== "true") return { connectionString };

  let url: URL;
  try {
    url = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
  } catch {
    // URL parsing errors otherwise include the full password-bearing input.
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URI");
  }
  // pg merges URI options after PoolConfig; remove anything that can replace verified TLS.
  for (const name of [...url.searchParams.keys()]) {
    if (name.toLowerCase().startsWith("ssl") || name === "uselibpqcompat")
      url.searchParams.delete(name);
  }

  const ssl: ConnectionOptions = { rejectUnauthorized: true };
  if (environment.DATABASE_CA_CERT?.trim()) {
    // A project-specific CA explicitly supplied by the operator takes precedence.
    ssl.ca = environment.DATABASE_CA_CERT.trim().replace(/\\n/g, "\n");
  } else if (isSupabase(url.hostname)) {
    // Supabase's private production roots are not in Node's public CA store.
    // These are public certificates from the official Supabase CLI, including its rotation.
    ssl.ca = [
      ...getCACertificates("default"),
      ...["2021", "2025"].map((year) =>
        readFileSync(
          /* turbopackIgnore: true */ join(
            process.cwd(),
            "certs",
            `supabase-prod-ca-${year}.crt`,
          ),
          "utf8",
        ),
      ),
    ];
  }
  return { connectionString: url.toString(), ssl };
}
