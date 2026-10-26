import { test } from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer, connect, type ConnectionOptions } from "node:tls";
import { Client } from "pg";
import { postgresConnectionOptions } from "../lib/postgres-config";

const host = "aws-0-eu-central-1.pooler.supabase.com";
const options = (hostname = host, override: Record<string, string | undefined> = {}) =>
  postgresConnectionOptions({
    DATABASE_URL: `postgresql://fixture:fixture@${hostname}:5432/postgres`,
    DATABASE_SSL: "true",
    ...override,
  });
test("Supabase production CA rotation is trusted without replacing the public trust store", () => {
  const ssl = options().ssl as ConnectionOptions;
  assert.equal(ssl.rejectUnauthorized, true);
  assert.ok(Array.isArray(ssl.ca) && ssl.ca.length > 2);
  const fingerprints = [
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
    "5F:9B:77:95:1A:7A:A1:30:3F:9B:58:EE:A9:BF:A8:9E:35:8C:FD:C1:5F:97:86:FF:10:D4:93:0A:72:2C:9A:E2",
  ];
  const roots = (ssl.ca as string[])
    .slice(-2)
    .map((pem) => new X509Certificate(pem));
  for (const [i, cert] of roots.entries()) {
    assert.equal(cert.fingerprint256, fingerprints[i]);
    assert.equal(cert.ca, true);
    assert.equal(cert.verify(cert.publicKey), true);
    assert.ok(
      Date.parse(cert.validFrom) < Date.now() &&
        Date.parse(cert.validTo) > Date.now(),
    );
  }
  assert.deepEqual(
    (options("db.kmpkfgenbomkbdzwpfbx.supabase.co").ssl as ConnectionOptions)
      .ca,
    ssl.ca,
  );
});
test("URI SSL options cannot turn off chain or hostname verification or discard Supabase CAs", () => {
  const config = options(host, {
    DATABASE_URL: `postgresql://fixture:fixture@${host}/postgres?sslmode=no-verify&ssl=false&sslrootcert=wrong-file&sslnegotiation=direct&uselibpqcompat=true&application_name=yolda`,
  });
  const client = new Client(config);
  const parsedTLS = (client as unknown as {ssl:ConnectionOptions}).ssl;
  assert.equal(parsedTLS.rejectUnauthorized, true);
  assert.ok(Array.isArray(parsedTLS.ca));
  assert.equal(parsedTLS.checkServerIdentity, undefined);
  const url = new URL(config.connectionString!);
  assert.equal(url.searchParams.get("application_name"), "yolda");
  assert.deepEqual([...url.searchParams.keys()], ["application_name"]);
});
test("Other providers and lookalike domains do not inherit the Supabase private roots", () => {
  for (const hostname of [
    "db.example.com",
    "db.fake.supabase.co.attacker.test",
    "pooler.supabase.com.attacker.test",
  ]) {
    const ssl = options(hostname).ssl as ConnectionOptions;
    assert.equal(ssl.rejectUnauthorized, true);
    assert.equal(ssl.ca, undefined);
  }
  assert.equal(
    postgresConnectionOptions({ DATABASE_URL: "postgres://localhost/test" })
      .ssl,
    undefined,
  );
});
test("An explicit per-project certificate overrides the bundled roots and supports escaped newlines", () => {
  const certificate = readFileSync(
    "certs/supabase-prod-ca-2025.crt",
    "utf8",
  ).trim();
  assert.equal(
    (
      options(host, { DATABASE_CA_CERT: certificate.replaceAll("\n", "\\n") })
        .ssl as ConnectionOptions
    ).ca,
    certificate,
  );
});
test("Invalid database URIs are rejected without exposing password-bearing input", () => {
  const secret = "private-fixture-password-that-must-not-appear";
  assert.throws(
    () => options(host, { DATABASE_URL: "broken-database-url-" + secret }),
    (error) => {
      assert.equal(
        (error as Error).message,
        "DATABASE_URL must be a valid PostgreSQL connection URI",
      );
      assert.ok(!(error as Error).message.includes(secret));
      return true;
    },
  );
});
test("TLS handshake accepts an explicitly trusted CA and rejects an untrusted chain and wrong hostname", async () => {
  const directory = mkdtempSync(join(tmpdir(), "yolda-tls-"));
  let server: ReturnType<typeof createServer> | undefined;
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "2",
        "-subj",
        "/CN=Yolda Test Root",
        "-addext",
        "subjectAltName=DNS:localhost",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
        "-keyout",
        join(directory, "key.pem"),
        "-out",
        join(directory, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
    const cert = readFileSync(join(directory, "cert.pem"), "utf8");
    server = createServer(
      { key: readFileSync(join(directory, "key.pem")), cert },
      (socket) => socket.end(),
    );
    server.on("tlsClientError", () => {});
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    const handshake = (ssl: ConnectionOptions, servername = "localhost") =>
      new Promise<void>((resolve, reject) => {
        const socket = connect(
          { ...ssl, host: "127.0.0.1", port, servername },
          () => {
            socket.end();
            resolve();
          },
        );
        socket.once("error", reject);
        socket.setTimeout(5000, () =>
          socket.destroy(new Error("TLS fixture timeout")),
        );
      });
    await assert.rejects(handshake(options().ssl as ConnectionOptions), {
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    const explicit = options("localhost", { DATABASE_CA_CERT: cert })
      .ssl as ConnectionOptions;
    await handshake(explicit);
    await assert.rejects(handshake(explicit, "wrong-host.example"), {
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
  } finally {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((e) => (e ? reject(e) : resolve())),
      );
    rmSync(directory, { recursive: true, force: true });
  }
});
