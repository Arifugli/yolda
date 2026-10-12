import { createHmac } from "node:crypto";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
let keyPromise: Promise<Buffer> | undefined;
async function key() {
  if (process.env.APP_ENCRYPTION_KEY) {
    if (!/^[0-9a-f]{64}$/i.test(process.env.APP_ENCRYPTION_KEY))
      throw new Error("APP_ENCRYPTION_KEY must be 32-byte hex");
    return Buffer.from(process.env.APP_ENCRYPTION_KEY, "hex");
  }
  if (
    process.env.APP_MODE !== "demo" ||
    process.env.DEPLOYMENT_ENV === "production"
  )
    throw new Error("Production requires an explicit encryption key");
  if (!keyPromise)
    keyPromise = (async () => {
      const directory = resolve(
        /* turbopackIgnore: true */ process.env.STORAGE_DIR ?? "storage",
      );
      await mkdir(/* turbopackIgnore: true */ directory, { recursive: true });
      const path = join(directory, ".response-key");
      try {
        return await readFile(/* turbopackIgnore: true */ path);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        const generated = randomBytes(32);
        try {
          await writeFile(/* turbopackIgnore: true */ path, generated, {
            flag: "wx",
            mode: 0o600,
          });
          return generated;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          return readFile(/* turbopackIgnore: true */ path);
        }
      }
    })();
  const k = await keyPromise;
  if (k.length !== 32) throw new Error("Invalid stored key");
  return k;
}
// Codes/invites in replay responses must not defeat the hashes in their own tables.
export async function encryptResponse(value: unknown, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await key(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}
export async function decryptResponse(value: any, context: string) {
  if (value.v !== 1)
    throw new Error(
      "Legacy response cannot be replayed; use a fresh idempotency key",
    );
  const decipher = createDecipheriv(
    "aes-256-gcm",
    await key(),
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
}
export function canonical(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

export async function codeDigest(value: string, context: string) {
  return createHmac("sha256", await key())
    .update(context + "\0" + value)
    .digest("hex");
}
