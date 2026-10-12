import { mkdir, readFile, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
// Public trust certificates and DNS routing only. Never copy proxy credentials into a file.
const directory = "/workspace/yolda-environment-build";
await mkdir(directory, { recursive: true });
let certificates = await readFile("/etc/ssl/certs/ca-certificates.crt");
if (process.env.NODE_EXTRA_CA_CERTS)
  certificates = Buffer.concat([
    certificates,
    Buffer.from("\n"),
    await readFile(process.env.NODE_EXTRA_CA_CERTS),
  ]);
if (certificates.includes(Buffer.from("PRIVATE KEY")))
  throw new Error("Expected public CA certificates only");
const certPath = directory + "/trusted-public-ca.crt";
await writeFile(certPath, certificates);
const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
const extraHosts: Record<string, string> = {};
if (proxy) {
  const host = new URL(proxy).hostname;
  extraHosts[host] = (await lookup(host, { family: 4 })).address;
}
const build = {
  network: "host",
  extra_hosts: extraHosts,
  args: {
    HTTP_PROXY: "${HTTP_PROXY:-}",
    HTTPS_PROXY: "${HTTPS_PROXY:-}",
    NO_PROXY: "${NO_PROXY:-}",
  },
  secrets: ["env_ca"],
};
const override = directory + "/compose.json";
await writeFile(
  override,
  JSON.stringify(
    {
      services: { app: { build }, storage: { build } },
      secrets: { env_ca: { file: certPath } },
    },
    null,
    2,
  ),
);
const dockerConfig = process.env.DOCKER_CONFIG ?? "/workspace/.docker";
await mkdir(dockerConfig, { recursive: true });
const result = spawnSync(
  "docker",
  [
    "compose",
    "-f",
    resolve("compose.yaml"),
    "-f",
    override,
    "-p",
    process.env.COMPOSE_PROJECT_NAME ?? "yolda",
    "up",
    "--build",
    "-d",
    "--wait",
    "--wait-timeout",
    "120",
  ],
  { stdio: "inherit", env: { ...process.env, DOCKER_CONFIG: dockerConfig } },
);
process.exit(result.status ?? 1);
