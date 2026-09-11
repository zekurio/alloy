import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { authSession, user } from "@alloy/db/auth-schema"
import { clip } from "@alloy/db/schema"
import { eq } from "drizzle-orm"
import sharp from "sharp"
import { test } from "vite-plus/test"

test.skipIf(!process.env.ALLOY_TEST_DATABASE_URL)(
  "image edits replace media on the same post and reject stale or unauthorized saves",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "alloy-image-edit-"))
    process.env.NODE_ENV = "production"
    process.env.DATABASE_URL = process.env.ALLOY_TEST_DATABASE_URL
    process.env.PUBLIC_SERVER_URL = "https://alloy.example"
    process.env.ALLOY_VIEWER_COOKIE_SECRET = "v".repeat(32)
    process.env.ALLOY_UPLOAD_HMAC_SECRET = "u".repeat(32)
    process.env.ALLOY_STORAGE_FS_CLIPS_PATH = join(directory, "clips")
    process.env.ALLOY_STORAGE_FS_THUMBNAILS_PATH = join(directory, "thumbnails")
    process.env.ALLOY_STORAGE_FS_ASSETS_PATH = join(directory, "assets")
    const { db, client } = await import("@alloy/server/db/index")
    const { clipsUploadImageRoutes } = await import("./clips-upload-image")
    const { hashSessionToken } = await import("@alloy/server/auth/tokens")
    const { clipAssetVersion } =
      await import("@alloy/server/clips/asset-version")
    const { runScopedSourceKey } =
      await import("@alloy/server/queue/media-asset-keys")
    const { clipStorage, clipThumbnailStorage } =
      await import("@alloy/server/storage/index")
    const authorId = randomUUID()
    const clipId = randomUUID()
    const token = randomUUID()
    const sourceKey = runScopedSourceKey(clipId, randomUUID())
    const version = clipAssetVersion(sourceKey)
    const image = await sharp({
      create: { width: 32, height: 16, channels: 3, background: "red" },
    })
      .png()
      .toBuffer()
    const save = (
      sourceVersion: string,
      authenticated = true,
      bytes: Uint8Array = new Uint8Array(image),
    ) => {
      const body = new FormData()
      body.set(
        "file",
        new File([new Uint8Array(bytes)], "edit.png", { type: "image/png" }),
      )
      body.set("sourceVersion", sourceVersion)
      return clipsUploadImageRoutes.request(`/${clipId}/image`, {
        method: "POST",
        body,
        headers: authenticated ? { Cookie: `alloy_access=${token}` } : {},
      })
    }
    try {
      await db
        .insert(user)
        .values({ id: authorId, username: `image-${authorId}` })
      await db.insert(authSession).values({
        user_id: authorId,
        token_hash: await hashSessionToken(token),
        expires_at: new Date(Date.now() + 60_000),
      })
      await db.insert(clip).values({
        id: clipId,
        author_id: authorId,
        title: "Keep this post",
        media_kind: "image",
        status: "ready",
        source_key: sourceKey,
        source_content_type: "image/png",
        width: 64,
        height: 64,
      })
      assert.equal((await save(version, false)).status, 401)
      assert.equal((await save("stale")).status, 409)
      assert.equal(
        (await save(version, true, new TextEncoder().encode("broken"))).status,
        400,
      )
      const response = await save(version)
      assert.equal(response.status, 200, await response.clone().text())
      const result = await response.json()
      assert.equal(result.id, clipId)
      assert.equal(result.title, "Keep this post")
      assert.deepEqual([result.width, result.height], [32, 16])
      assert.notEqual(result.sourceVersion, version)
      const [saved] = await db.select().from(clip).where(eq(clip.id, clipId))
      assert.ok(saved.source_key)
      assert.ok(saved.thumb_key)
      assert.ok(await clipStorage.resolve(saved.source_key))
      assert.ok(await clipThumbnailStorage.resolve(saved.thumb_key))
      assert.equal((await save(version)).status, 409)
    } finally {
      await db.delete(user).where(eq(user.id, authorId))
      await client.end()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
