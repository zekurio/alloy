import assert from "node:assert/strict"
import test from "node:test"

import { S3StorageDriver } from "./s3-driver"

test("S3StorageDriver mints direct presigned PUT upload tickets", async () => {
  const storage = new S3StorageDriver({
    bucket: "alloy-test",
    region: "us-east-1",
    endpoint: "https://s3.example.com",
    forcePathStyle: true,
    prefix: "storage/clips",
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
  })

  const ticket = await storage.mintUploadUrl({
    key: "uploads/clip-id/source.mp4",
    contentType: "video/mp4",
    maxBytes: 1234,
    expiresInSec: 900,
    userId: "user-id",
    clipId: "clip-id",
  })
  const url = new URL(ticket.uploadUrl)

  assert.equal(ticket.method, "PUT")
  assert.equal(ticket.headers["Content-Type"], "video/mp4")
  assert.equal(url.hostname, "s3.example.com")
  assert.equal(
    url.pathname,
    "/alloy-test/storage/clips/uploads/clip-id/source.mp4",
  )
  assert.equal(url.searchParams.get("X-Amz-Expires"), "900")
  assert.ok(url.searchParams.has("X-Amz-Signature"))
  assert.ok(url.searchParams.has("X-Amz-Credential"))
})
