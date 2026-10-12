import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { prepareStorage, store, load } from "../lib/storage";
test("Приватное S3-хранилище: подписанная запись/чтение, анонимный запрос запрещен", async () => {
  assert.equal(
    process.env.STORAGE_DRIVER,
    "s3",
    "This check requires the documented S3 demo storage",
  );
  await prepareStorage();
  const id = randomUUID();
  const data = Buffer.from("private-object-smoke");
  await store(id, data, "application/octet-stream");
  try {
    assert.deepEqual(await load(id), data);
    const r = await fetch(
      `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${id}`,
    );
    assert.equal(r.status, 403);
  } finally {
    const client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      },
    });
    await client.send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: id }),
    );
    client.destroy();
  }
});
