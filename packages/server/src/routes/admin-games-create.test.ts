import assert from "node:assert/strict"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import sharp from "sharp"

const testDatabaseUrl = process.env.ALLOY_TEST_DATABASE_URL

if (!testDatabaseUrl) {
  test(
    "admin game creation postgres tests",
    { skip: "ALLOY_TEST_DATABASE_URL is not set" },
    () => {},
  )
} else {
  const storageRoot = await mkdtemp(join(tmpdir(), "alloy-admin-games-"))
  const assetsRoot = join(storageRoot, "assets")
  process.env.ALLOY_STORAGE_FS_ASSETS_PATH = assetsRoot

  const { prepareTestDatabase } = await import("@alloy/server/db/test-database")
  await prepareTestDatabase("admin-games-create")

  // Dynamic imports are required here because DB and storage modules read
  // env at module load time, after prepareTestDatabase installs the isolated
  // test URL and the assets path above is set.
  const { game } = await import("@alloy/db/schema")
  const { db, client } = await import("@alloy/server/db/index")
  const { gameAssetKey } = await import("@alloy/server/storage/driver")
  const { Hono } = await import("hono")
  const { adminGamesRoute } = await import("./admin-games")
  const { eq } = await import("drizzle-orm")

  after(async () => {
    await client.end()
    await rm(storageRoot, { recursive: true, force: true })
  })

  // Mounted without the admin session middleware on purpose: these tests
  // exercise route behavior, not auth.
  const app = new Hono().route("/admin", adminGamesRoute)

  function pngFile(name: string, bytes: BlobPart) {
    return new File([bytes], name, { type: "image/png" })
  }

  async function solidPng(width: number, height: number) {
    const bytes = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 200, g: 40, b: 40 },
      },
    })
      .png()
      .toBuffer()
    // Copy into a plain ArrayBuffer-backed view: Buffer is not a BlobPart.
    return new Uint8Array(bytes)
  }

  type GameResponse = {
    id: string
    slug: string
    releaseDate: string | null
    heroUrl: string | null
    heroBlurHash: string | null
    gridUrl: string | null
    gridBlurHash: string | null
    logoUrl: string | null
    iconUrl: string | null
  }

  function createGame(form: FormData) {
    return app.request("/admin/games", { method: "POST", body: form })
  }

  test("creates a game with artwork in one request", async () => {
    const form = new FormData()
    form.set("name", "Combined Arms")
    form.set("grid", pngFile("grid.png", await solidPng(60, 90)))
    form.set("hero", pngFile("hero.png", await solidPng(192, 62)))

    const res = await createGame(form)
    assert.equal(res.status, 201)
    const body = (await res.json()) as GameResponse

    assert.equal(body.slug, "combined-arms")
    assert.ok(body.gridUrl)
    assert.ok(body.heroUrl)
    assert.ok(body.gridBlurHash)
    assert.ok(body.heroBlurHash)
    assert.equal(body.logoUrl, null)
    assert.equal(body.iconUrl, null)

    // The processed webp files exist where the asset route will resolve them.
    for (const role of ["grid", "hero"] as const) {
      const stats = await stat(
        join(assetsRoot, gameAssetKey(body.id, role, ".webp")),
      )
      assert.ok(stats.size > 0)
    }
  })

  test("rejects the whole request when one image is invalid", async () => {
    const form = new FormData()
    form.set("name", "Broken Artwork")
    form.set("grid", pngFile("grid.png", await solidPng(60, 90)))
    form.set("hero", pngFile("hero.png", "not an image"))

    const res = await createGame(form)
    assert.equal(res.status, 400)
    const body = (await res.json()) as { error: string }
    assert.match(body.error, /^hero:/)

    // Nothing may persist when any artwork fails: no half-created games.
    const rows = await db
      .select({ id: game.id })
      .from(game)
      .where(eq(game.name, "Broken Artwork"))
    assert.equal(rows.length, 0)
  })

  test("creates a metadata-only game", async () => {
    const form = new FormData()
    form.set("name", "Plain Game")
    form.set("releaseDate", "2024-05-01T00:00:00.000Z")

    const res = await createGame(form)
    assert.equal(res.status, 201)
    const body = (await res.json()) as GameResponse

    assert.equal(body.slug, "plain-game")
    assert.equal(body.releaseDate, "2024-05-01T00:00:00.000Z")
    assert.equal(body.heroUrl, null)
    assert.equal(body.gridUrl, null)
    assert.equal(body.logoUrl, null)
    assert.equal(body.iconUrl, null)
  })

  test("name collisions get a distinct slug", async () => {
    const first = new FormData()
    first.set("name", "Twin Title")
    const firstRes = await createGame(first)
    assert.equal(firstRes.status, 201)

    const second = new FormData()
    second.set("name", "Twin Title")
    const secondRes = await createGame(second)
    assert.equal(secondRes.status, 201)

    const firstBody = (await firstRes.json()) as GameResponse
    const secondBody = (await secondRes.json()) as GameResponse
    assert.equal(firstBody.slug, "twin-title")
    assert.equal(secondBody.slug, "twin-title-2")
  })
}
