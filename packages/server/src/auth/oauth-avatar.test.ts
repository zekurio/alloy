import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises"
import { createServer } from "node:http"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, beforeEach, test } from "node:test"

import sharp from "sharp"

import type { OAuthProfile } from "./oauth-types"

const testDatabaseUrl = process.env.ALLOY_TEST_DATABASE_URL

if (!testDatabaseUrl) {
  test(
    "OAuth avatar sync postgres tests",
    { skip: "ALLOY_TEST_DATABASE_URL is not set" },
    () => {},
  )
} else {
  const storageRoot = await mkdtemp(join(tmpdir(), "alloy-oauth-avatar-"))
  const assetsRoot = join(storageRoot, "assets")
  process.env.ALLOY_STORAGE_FS_ASSETS_PATH = assetsRoot
  // The fixture image server binds to loopback, which the default SSRF guard
  // rejects; opt in like a LAN deployment would.
  process.env.ALLOY_OAUTH_AVATAR_ALLOW_PRIVATE_URLS = "1"

  // Static imports would capture env before this test installs database/storage paths.
  const testDatabase = await import("@alloy/server/db/test-database")
  await testDatabase.prepareTestDatabase("oauth-avatar")

  // Static imports would capture env before this test installs database/storage paths.
  const authSchema = await import("@alloy/db/auth-schema")
  const database = await import("@alloy/server/db/index")
  const { userAssetKey } = await import("@alloy/server/storage/driver")
  const { syncOAuthAvatar } = await import("@alloy/server/auth/oauth-avatar")
  const { eq } = await import("drizzle-orm")

  const avatarPng = await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 3,
      background: "#fff",
    },
  })
    .png()
    .toBuffer()

  after(async () => {
    await database.client.end()
    await rm(storageRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await database.db.delete(authSchema.user)
    await rm(assetsRoot, { recursive: true, force: true })
    await mkdir(assetsRoot, { recursive: true })
  })

  test("uploads a provider avatar for a user without an image", async () => {
    const userId = crypto.randomUUID()
    await insertUser({ userId, image: null })
    const server = await serveAvatar({
      contentType: "image/png",
      body: avatarPng,
    })

    try {
      await syncOAuthAvatar(userId, oauthProfile(server.url))
    } finally {
      await server.close()
    }

    const image = await selectImage(userId)
    assert.match(
      image ?? "",
      new RegExp(
        `^/api/assets/users/${userAssetDirPattern(userId)}/avatar\\.webp\\?v=[0-9a-z]+$`,
      ),
    )
    assert.equal(server.requests(), 1)
    assert.equal(
      await fileExists(
        join(assetsRoot, userAssetKey(userId, "avatar", ".webp")),
      ),
      true,
    )
  })

  test("keeps an existing user image without fetching the provider avatar", async () => {
    const userId = crypto.randomUUID()
    const existingImage = "/api/assets/users/existing/avatar.webp?v=kept"
    await insertUser({ userId, image: existingImage })
    const server = await serveAvatar({
      contentType: "image/png",
      body: avatarPng,
    })

    try {
      await syncOAuthAvatar(userId, oauthProfile(server.url))
    } finally {
      await server.close()
    }

    assert.equal(await selectImage(userId), existingImage)
    assert.equal(server.requests(), 0)
  })

  test("leaves image empty when the provider avatar returns 404", async () => {
    const userId = crypto.randomUUID()
    await insertUser({ userId, image: null })
    const server = await serveAvatar({
      status: 404,
      contentType: "image/png",
      body: "not found",
    })

    try {
      await syncOAuthAvatar(userId, oauthProfile(server.url))
    } finally {
      await server.close()
    }

    assert.equal(await selectImage(userId), null)
    assert.equal(server.requests(), 1)
  })

  test("leaves image empty when the provider avatar is not an image", async () => {
    const userId = crypto.randomUUID()
    await insertUser({ userId, image: null })
    const server = await serveAvatar({
      contentType: "text/html",
      body: "<p>not an image</p>",
    })

    try {
      await syncOAuthAvatar(userId, oauthProfile(server.url))
    } finally {
      await server.close()
    }

    assert.equal(await selectImage(userId), null)
    assert.equal(server.requests(), 1)
  })

  test("skips provider avatars in unsupported image formats", async () => {
    const userId = crypto.randomUUID()
    await insertUser({ userId, image: null })
    // Passes the transport-level image/* check; parseImageBytes rejects gif.
    const server = await serveAvatar({
      contentType: "image/gif",
      body: Buffer.from("GIF89a"),
    })

    try {
      await syncOAuthAvatar(userId, oauthProfile(server.url))
    } finally {
      await server.close()
    }

    assert.equal(await selectImage(userId), null)
    assert.equal(server.requests(), 1)
  })

  test("does nothing when the provider profile has no avatar URL", async () => {
    const userId = crypto.randomUUID()
    await insertUser({ userId, image: null })

    await syncOAuthAvatar(userId, oauthProfile(null))

    assert.equal(await selectImage(userId), null)
  })

  async function insertUser(input: {
    userId: string
    image: string | null
  }): Promise<void> {
    await database.db.insert(authSchema.user).values({
      id: input.userId,
      email: `${input.userId}@example.test`,
      username: `user-${input.userId.slice(0, 8)}`,
      image: input.image,
    })
  }

  async function selectImage(userId: string): Promise<string | null> {
    const [row] = await database.db
      .select({ image: authSchema.user.image })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, userId))
      .limit(1)
    return row?.image ?? null
  }

  function oauthProfile(avatarUrl: string | null): OAuthProfile {
    return {
      avatarUrl,
      email: "user@example.test",
      emailVerified: true,
      providerAccountId: "provider-account",
      raw: {},
      role: undefined,
      storageQuotaBytes: null,
      usernameHint: "oauth-user",
    }
  }

  async function serveAvatar(response: {
    status?: number
    contentType: string
    body: Uint8Array | string
  }): Promise<{
    url: string
    requests: () => number
    close: () => Promise<void>
  }> {
    let requests = 0
    const server: Server = createServer((_req, res) => {
      requests += 1
      res.statusCode = response.status ?? 200
      res.setHeader("content-type", response.contentType)
      res.end(response.body)
    })

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject)
        resolve()
      })
    })

    const address = server.address()
    assert.ok(address && typeof address !== "string")
    return {
      url: `http://127.0.0.1:${(address as AddressInfo).port}/avatar`,
      requests: () => requests,
      close: () =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => {
            if (err) {
              reject(err)
              return
            }
            resolve()
          })
        }),
    }
  }

  async function fileExists(path: string): Promise<boolean> {
    const result = await stat(path).catch((err) => {
      if ((err as { code?: string } | null)?.code === "ENOENT") return null
      throw err
    })
    return result !== null
  }

  function userAssetDirPattern(userId: string): string {
    const hex = userId.replace(/-/g, "")
    return `${hex.slice(0, 2)}/${hex.slice(2, 4)}/${userId}`
  }
}
