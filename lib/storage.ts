import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const useS3 = () => process.env.STORAGE_DRIVER === "s3";
const bucket = () => process.env.S3_BUCKET ?? "yolda-private";
function client() {
  if (!process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY)
    throw new Error("S3 credentials are required");
  return new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
  });
}
export async function prepareStorage() {
  if (!useS3()) return;
  const s3 = client();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket() }));
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    if (status !== 404) throw e;
    await s3.send(new CreateBucketCommand({ Bucket: bucket() }));
  }
}
export async function store(id: string, bytes: Buffer, mime: string) {
  if (useS3()) {
    await client().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: id,
        Body: bytes,
        ContentType: mime,
      }),
    );
    return;
  }
  if (process.env.APP_MODE !== "demo")
    throw new Error("Production requires private S3 storage");
  const dir = resolve(
    /* turbopackIgnore: true */ process.env.STORAGE_DIR ?? "storage",
  );
  await mkdir(/* turbopackIgnore: true */ dir, { recursive: true });
  await writeFile(/* turbopackIgnore: true */ join(dir, id), bytes, {
    flag: "wx",
    mode: 0o600,
  });
}
export async function load(id: string) {
  if (useS3()) {
    const r = await client().send(
      new GetObjectCommand({ Bucket: bucket(), Key: id }),
    );
    if (!r.Body) throw new Error("Object missing");
    return Buffer.from(await r.Body.transformToByteArray());
  }
  return readFile(
    /* turbopackIgnore: true */ join(
      resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? "storage"),
      id,
    ),
  );
}
