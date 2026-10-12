import S3rver from "s3rver";
import { mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:http";
if (process.env.DEPLOYMENT_ENV === "production")
  throw new Error("S3 emulator is development-only");
const directory = process.env.S3_DATA_DIR ?? "storage/objects";
await mkdir(directory, { recursive: true });
await access(directory, constants.W_OK);
const server = new S3rver({
  port: 9000,
  address: process.env.S3_BIND ?? "127.0.0.1",
  directory,
  silent: true,
  allowMismatchedSignatures: false,
  vhostBuckets: false,
});
const middleware = server.callback();
const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  if (!req.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ")) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Signed requests required");
    return;
  }
  middleware(req, res);
});
await new Promise<void>((resolve) =>
  httpServer.listen(9000, process.env.S3_BIND ?? "127.0.0.1", resolve),
);
console.log(
  "Demo S3-compatible storage listening on port 9000. Not a production storage service.",
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    process.exit(0);
  });
