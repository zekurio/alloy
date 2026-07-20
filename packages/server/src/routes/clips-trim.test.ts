import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, beforeEach, test } from "node:test"

const testDatabaseUrl = process.env.ALLOY_TEST_DATABASE_URL

if (!testDatabaseUrl) {
  test(
    "clip trim route postgres tests",
    { skip: "ALLOY_TEST_DATABASE_URL is not set" },
    () => {},
  )
} else {
  const storageRoot = await mkdtemp(join(tmpdir(), "alloy-clips-trim-"))
  process.env.ALLOY_STORAGE_FS_CLIPS_PATH = join(storageRoot, "clips")
  process.env.ALLOY_STORAGE_FS_THUMBNAILS_PATH = join(storageRoot, "thumbnails")
  process.env.ALLOY_STORAGE_FS_ASSETS_PATH = join(storageRoot, "assets")

  const { prepareTestDatabase } = await import("@alloy/server/db/test-database")
  await prepareTestDatabase("clips-trim")

  // Dynamic imports are required because these modules import db/index and
  // storage/index, which read DATABASE_URL / storage paths at import time;
  // prepareTestDatabase and the env assignments above must run first.
  const { authSession, user } = await import("@alloy/db/auth-schema")
  const { clip, clipRendition, job } = await import("@alloy/db/schema")
  const { hashSessionToken } = await import("@alloy/server/auth/tokens")
  const { db, client } = await import("@alloy/server/db/index")
  const { runScopedCutKey, runScopedRenditionKey, runScopedSourceKey } =
    await import("@alloy/server/queue/media-asset-keys")
  const { clips } = await import("@alloy/server/routes/clips")
  const { clipStorage } = await import("@alloy/server/storage/index")
  const { eq } = await import("drizzle-orm")
  const { Hono } = await import("hono")

  const routeApp = new Hono().route("/api/clips", clips)

  after(async () => {
    await client.end()
    await rm(storageRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await db.delete(job)
    await db.delete(clip)
    await db.delete(authSession)
    await db.delete(user)
  })

  test("trim deletes rendition records and files, keeps the old cut", async () => {
    const owner = await insertUser("owner")
    const cookie = await sessionCookieFor(owner.id)
    const clipId = crypto.randomUUID()
    const runId = crypto.randomUUID()
    const sourceKey = runScopedSourceKey(clipId, runId)
    const oldCutKey = runScopedCutKey(clipId, runId)
    const renditionKeys = [
      runScopedRenditionKey(clipId, runId, "720p"),
      runScopedRenditionKey(clipId, runId, "480p"),
    ]
    const encoder = new TextEncoder()
    await clipStorage.put(sourceKey, encoder.encode("source"), "video/mp4")
    await clipStorage.put(oldCutKey, encoder.encode("old-cut"), "video/mp4")
    for (const key of renditionKeys) {
      await clipStorage.put(key, encoder.encode("rendition"), "video/mp4")
    }
    await db.insert(clip).values({
      id: clipId,
      author_id: owner.id,
      title: "Trim test clip",
      status: "ready",
      source_key: sourceKey,
      source_content_type: "video/mp4",
      source_duration_ms: 10_000,
      duration_ms: 4000,
      trim_start_ms: 1000,
      trim_end_ms: 5000,
      cut_key: oldCutKey,
    })
    await db.insert(clipRendition).values(
      renditionKeys.map((key, index) => ({
        clip_id: clipId,
        name: index === 0 ? "720p" : "480p",
        is_og: index === 0,
        height: index === 0 ? 720 : 480,
        width: index === 0 ? 1280 : 854,
        fps: 60,
        storage_key: key,
        codecs: "avc1.64002a,mp4a.40.2",
        size_bytes: 1000,
      })),
    )

    const response = await routeApp.request(`/api/clips/${clipId}/trim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ startMs: 2000, endMs: 6000 }),
    })
    assert.equal(response.status, 200)

    const renditionRows = await db
      .select({ id: clipRendition.id })
      .from(clipRendition)
      .where(eq(clipRendition.clip_id, clipId))
    assert.equal(renditionRows.length, 0)
    for (const key of renditionKeys) {
      assert.equal(await clipStorage.resolve(key), null)
    }

    const [row] = await db
      .select({
        status: clip.status,
        trimStartMs: clip.trim_start_ms,
        trimEndMs: clip.trim_end_ms,
        cutKey: clip.cut_key,
      })
      .from(clip)
      .where(eq(clip.id, clipId))
      .limit(1)
    assert.deepEqual(row, {
      status: "processing",
      trimStartMs: 2000,
      trimEndMs: 6000,
      // The previously committed cut stays referenced until the run's
      // commitSource swaps in the new exact cut.
      cutKey: oldCutKey,
    })
    assert.ok(await clipStorage.resolve(oldCutKey))
    assert.ok(await clipStorage.resolve(sourceKey))

    const jobs = await db
      .select({ payload: job.payload })
      .from(job)
      .where(eq(job.kind, "clip.encode"))
    assert.equal(jobs.length, 1)
    assert.deepEqual(jobs[0]?.payload, { clipId, trigger: "trim" })
  })

  test("stream serves the cut when the clip has no renditions", async () => {
    const owner = await insertUser("streamer")
    const clipId = crypto.randomUUID()
    const runId = crypto.randomUUID()
    const sourceKey = runScopedSourceKey(clipId, runId)
    const cutKey = runScopedCutKey(clipId, runId)
    const encoder = new TextEncoder()
    await clipStorage.put(
      sourceKey,
      encoder.encode("source-bytes"),
      "video/mp4",
    )
    await clipStorage.put(cutKey, encoder.encode("cut-bytes"), "video/mp4")
    await db.insert(clip).values({
      id: clipId,
      author_id: owner.id,
      title: "Stream test clip",
      status: "ready",
      privacy: "public",
      source_key: sourceKey,
      source_content_type: "video/mp4",
      source_codecs: "avc1.64002a,mp4a.40.2",
      source_duration_ms: 10_000,
      duration_ms: 4000,
      trim_start_ms: 2000,
      trim_end_ms: 6000,
      cut_key: cutKey,
    })

    const response = await routeApp.request(`/api/clips/${clipId}/stream`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), "cut-bytes")

    // A source the plain-video consumers cannot decode normally prefers an
    // H.264 tier; with zero renditions the (now always H.264) cut serves.
    await db
      .update(clip)
      .set({ source_codecs: "hvc1.1.6.L120.90,mp4a.40.2" })
      .where(eq(clip.id, clipId))
    const hevcResponse = await routeApp.request(`/api/clips/${clipId}/stream`)
    assert.equal(hevcResponse.status, 200)
    assert.equal(await hevcResponse.text(), "cut-bytes")

    // An exact cut commits its own codec string: it wins over renditions
    // even when the source codec is undecodable.
    const renditionKey = runScopedRenditionKey(clipId, runId, "720p")
    await clipStorage.put(
      renditionKey,
      encoder.encode("rendition-bytes"),
      "video/mp4",
    )
    await db.insert(clipRendition).values({
      clip_id: clipId,
      name: "720p",
      is_og: true,
      height: 720,
      width: 1280,
      fps: 60,
      storage_key: renditionKey,
      codecs: "avc1.64002a,mp4a.40.2",
      size_bytes: 1000,
    })
    // Legacy stream-copy cut (null cut_codecs) defers to the H.264 tier...
    const legacyResponse = await routeApp.request(`/api/clips/${clipId}/stream`)
    assert.equal(legacyResponse.status, 200)
    assert.equal(await legacyResponse.text(), "rendition-bytes")
    // ...while a committed exact cut serves its own broadly decodable bytes.
    await db
      .update(clip)
      .set({ cut_codecs: "avc1.64001e,mp4a.40.2" })
      .where(eq(clip.id, clipId))
    const exactResponse = await routeApp.request(`/api/clips/${clipId}/stream`)
    assert.equal(exactResponse.status, 200)
    assert.equal(await exactResponse.text(), "cut-bytes")
  })

  async function insertUser(username: string): Promise<{ id: string }> {
    const id = crypto.randomUUID()
    await db.insert(user).values({
      id,
      email: `${username}-${id}@example.test`,
      username,
      display_name: username,
    })
    return { id }
  }

  async function sessionCookieFor(userId: string): Promise<string> {
    const token = crypto.randomUUID()
    await db.insert(authSession).values({
      token_hash: await hashSessionToken(token),
      user_id: userId,
      expires_at: new Date(Date.now() + 60_000),
      last_seen_at: new Date(),
    })
    return `alloy_access=${encodeURIComponent(token)}`
  }
}
