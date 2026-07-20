import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, beforeEach, test } from "node:test"

const testDatabaseUrl = process.env.ALLOY_TEST_DATABASE_URL

if (!testDatabaseUrl) {
  test(
    "storage verify postgres tests",
    { skip: "ALLOY_TEST_DATABASE_URL is not set" },
    () => {},
  )
} else {
  const storageRoot = await mkdtemp(join(tmpdir(), "alloy-storage-verify-"))
  const clipsRoot = join(storageRoot, "clips")
  const thumbnailsRoot = join(storageRoot, "thumbnails")
  process.env.ALLOY_STORAGE_FS_CLIPS_PATH = clipsRoot
  process.env.ALLOY_STORAGE_FS_THUMBNAILS_PATH = thumbnailsRoot
  process.env.ALLOY_STORAGE_FS_ASSETS_PATH = join(storageRoot, "assets")

  const testDatabase = await import("@alloy/server/db/test-database")
  await testDatabase.prepareTestDatabase("storage-verify")

  const contracts = await import("@alloy/contracts")
  const authSchema = await import("@alloy/db/auth-schema")
  const schema = await import("@alloy/db/schema")
  const database = await import("@alloy/server/db/index")
  const fingerprint = await import("@alloy/server/media/encode-fingerprint")
  const mediaKeys = await import("@alloy/server/queue/media-asset-keys")
  const storageDriver = await import("@alloy/server/storage/driver")
  const storage = await import("@alloy/server/storage/index")
  const registry = await import("../registry")
  await import("./storage-verify")
  const storageVerify = await import("./storage-verify")
  const drizzle = await import("drizzle-orm")

  const config = contracts.TranscodingConfigSchema.parse({})
  const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)

  after(async () => {
    await database.client.end()
    await rm(storageRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await database.db.delete(schema.job)
    await database.db.delete(schema.clip)
    await database.db.delete(authSchema.user)
    await database.db.delete(schema.instanceSetting)
    await rm(clipsRoot, { recursive: true, force: true })
    await rm(thumbnailsRoot, { recursive: true, force: true })
    await mkdir(clipsRoot, { recursive: true })
    await mkdir(thumbnailsRoot, { recursive: true })
  })

  test("missing rendition row is deleted and repair encode is enqueued", async () => {
    const clipId = await insertClip()
    const sourceKey = mediaKeys.runScopedSourceKey(
      clipId,
      runId("111111111111"),
    )
    const presentKey = mediaKeys.runScopedRenditionKey(
      clipId,
      runId("222222222222"),
      "720p",
    )
    const missingKey = mediaKeys.runScopedRenditionKey(
      clipId,
      runId("333333333333"),
      "480p",
    )
    await storage.clipStorage.put(sourceKey, bytes(), "video/mp4")
    await storage.clipStorage.put(presentKey, bytes(), "video/mp4")
    await database.db
      .update(schema.clip)
      .set({
        source_key: sourceKey,
        encode_fingerprint: expectedFingerprint(),
      })
      .where(drizzle.eq(schema.clip.id, clipId))
    await database.db
      .insert(schema.clipRendition)
      .values([
        rendition(clipId, "720p", presentKey),
        rendition(clipId, "480p", missingKey),
      ])

    const summary = await storageVerify.verifyClipAssets(clipId)

    assert.equal(summary.missingRenditions, 1)
    assert.equal(summary.repaired, 1)
    assert.deepEqual(await renditionNames(clipId), ["720p"])
    assert.equal((await selectClip(clipId))?.encodeFingerprint, null)
    assert.deepEqual(await clipEncodeJobs(), [
      {
        dedupKey: clipId,
        priority: 70,
        payload: { clipId, trigger: "repair" },
      },
    ])
  })

  test("guarded repair is skipped when an encode lease is active", async () => {
    const clipId = await insertClip()
    const sourceKey = mediaKeys.runScopedSourceKey(
      clipId,
      runId("444444444444"),
    )
    const cutKey = mediaKeys.runScopedCutKey(clipId, runId("555555555555"))
    await storage.clipStorage.put(sourceKey, bytes(), "video/mp4")
    await database.db
      .update(schema.clip)
      .set({
        source_key: sourceKey,
        cut_key: cutKey,
        encode_fingerprint: expectedFingerprint(),
        encode_run_id: crypto.randomUUID(),
      })
      .where(drizzle.eq(schema.clip.id, clipId))

    const summary = await storageVerify.verifyClipAssets(clipId)
    const row = await selectClip(clipId)

    assert.equal(summary.missingCuts, 1)
    assert.equal(summary.repaired, 0)
    assert.equal(row?.cutKey, cutKey)
    assert.equal(row?.encodeFingerprint, expectedFingerprint())
    assert.deepEqual(await clipEncodeJobs(), [])
  })

  test("missing source quarantines while surviving renditions keep status ready", async () => {
    const clipId = await insertClip()
    const sourceKey = mediaKeys.runScopedSourceKey(
      clipId,
      runId("666666666666"),
    )
    const renditionKey = mediaKeys.runScopedRenditionKey(
      clipId,
      runId("777777777777"),
      "720p",
    )
    await storage.clipStorage.put(renditionKey, bytes(), "video/mp4")
    await database.db
      .update(schema.clip)
      .set({
        source_key: sourceKey,
        encode_fingerprint: expectedFingerprint(),
      })
      .where(drizzle.eq(schema.clip.id, clipId))
    await database.db
      .insert(schema.clipRendition)
      .values(rendition(clipId, "720p", renditionKey))

    const summary = await storageVerify.verifyClipAssets(clipId)
    const row = await selectClip(clipId)

    assert.equal(summary.missingSources, 1)
    assert.equal(summary.repaired, 1)
    assert.equal(row?.status, "ready")
    assert.equal(row?.failureReason, "source bytes missing from storage")
    assert.equal(row?.encodeFailedFingerprint, expectedFingerprint())
    assert.deepEqual(await renditionNames(clipId), ["720p"])
    assert.deepEqual(await clipEncodeJobs(), [])
  })

  test("missing source with no playable bytes marks clip failed", async () => {
    const clipId = await insertClip()
    await database.db
      .update(schema.clip)
      .set({
        source_key: mediaKeys.runScopedSourceKey(clipId, runId("888888888888")),
        encode_fingerprint: expectedFingerprint(),
      })
      .where(drizzle.eq(schema.clip.id, clipId))

    const summary = await storageVerify.verifyClipAssets(clipId)
    const row = await selectClip(clipId)

    assert.equal(summary.missingSources, 1)
    assert.equal(summary.repaired, 1)
    assert.equal(row?.status, "failed")
    assert.equal(row?.failureReason, "source bytes missing from storage")
  })

  test("deleteClipRowAndAssets removes rendition files", async () => {
    const clipsDelete = await import("@alloy/server/clips/delete")
    const clipId = await insertClip()
    const sourceKey = mediaKeys.runScopedSourceKey(
      clipId,
      runId("999999999999"),
    )
    const thumbKey = mediaKeys.runScopedThumbKey(clipId, runId("aaaaaaaaaaaa"))
    const renditionKey = mediaKeys.runScopedRenditionKey(
      clipId,
      runId("bbbbbbbbbbbb"),
      "720p",
    )
    await storage.clipStorage.put(sourceKey, bytes(), "video/mp4")
    await storage.clipThumbnailStorage.put(thumbKey, bytes(), "image/jpeg")
    await storage.clipThumbnailStorage.put(
      storageDriver.clipAssetKey(clipId, "scrubber"),
      bytes(),
      "image/jpeg",
    )
    await storage.clipStorage.put(renditionKey, bytes(), "video/mp4")
    await database.db
      .update(schema.clip)
      .set({ source_key: sourceKey, thumb_key: thumbKey })
      .where(drizzle.eq(schema.clip.id, clipId))
    await database.db
      .insert(schema.clipRendition)
      .values(rendition(clipId, "720p", renditionKey))
    const row = await selectRawClip(clipId)
    assert.ok(row)

    await clipsDelete.deleteClipRowAndAssets(row)

    assert.equal(await storage.clipStorage.resolve(sourceKey), null)
    assert.equal(await storage.clipStorage.resolve(renditionKey), null)
    assert.equal(await storage.clipThumbnailStorage.resolve(thumbKey), null)
    assert.equal(
      await storage.clipThumbnailStorage.resolve(
        storageDriver.clipAssetKey(clipId, "scrubber"),
      ),
      null,
    )
  })

  test("orphan gc removes only old orphan and stale run-stamped assets", async () => {
    const registration = registry.getJobKind("storage.orphan-gc")
    assert.ok(registration)
    const existingClipId = await insertClip()
    const orphanOldId = crypto.randomUUID()
    const orphanYoungId = crypto.randomUUID()
    const orphanThumbId = crypto.randomUUID()
    const liveSource = mediaKeys.runScopedSourceKey(
      existingClipId,
      runId("cccccccccccc"),
    )
    const staleAsset = mediaKeys.runScopedRenditionKey(
      existingClipId,
      runId("dddddddddddd"),
      "720p",
    )
    const youngAsset = mediaKeys.runScopedCutKey(
      existingClipId,
      runId("eeeeeeeeeeee"),
    )
    const unknownAsset = `${storageDriver.clipAssetDir(existingClipId)}/notes.txt`
    const orphanOld = mediaKeys.runScopedSourceKey(
      orphanOldId,
      runId("abababababab"),
    )
    const orphanYoung = mediaKeys.runScopedSourceKey(
      orphanYoungId,
      runId("bcbcbcbcbcbc"),
    )
    const orphanThumb = mediaKeys.runScopedThumbKey(
      orphanThumbId,
      runId("cdcdcdcdcdcd"),
    )

    await storage.clipStorage.put(liveSource, bytes(), "video/mp4")
    await storage.clipStorage.put(staleAsset, bytes(), "video/mp4")
    await storage.clipStorage.put(youngAsset, bytes(), "video/mp4")
    await storage.clipStorage.put(unknownAsset, bytes(), "text/plain")
    await storage.clipStorage.put(orphanOld, bytes(), "video/mp4")
    await storage.clipStorage.put(orphanYoung, bytes(), "video/mp4")
    await storage.clipThumbnailStorage.put(orphanThumb, bytes(), "image/jpeg")
    await mkdir(clipsRoot, { recursive: true })
    await writeFile(join(clipsRoot, "loose-file"), "unknown")
    await Promise.all([
      setClipMtime(staleAsset, oldDate),
      setClipMtime(unknownAsset, oldDate),
      setClipMtime(orphanOld, oldDate),
      setThumbMtime(orphanThumb, oldDate),
      utimes(join(clipsRoot, "loose-file"), oldDate, oldDate),
    ])
    await database.db
      .update(schema.clip)
      .set({ source_key: liveSource })
      .where(drizzle.eq(schema.clip.id, existingClipId))

    await registration.handler({}, contextFor())

    assert.ok(await storage.clipStorage.resolve(liveSource))
    assert.equal(await storage.clipStorage.resolve(staleAsset), null)
    assert.ok(await storage.clipStorage.resolve(youngAsset))
    assert.ok(await storage.clipStorage.resolve(unknownAsset))
    assert.equal(await storage.clipStorage.resolve(orphanOld), null)
    assert.ok(await storage.clipStorage.resolve(orphanYoung))
    assert.equal(await storage.clipThumbnailStorage.resolve(orphanThumb), null)
    assert.ok(await fileExists(join(clipsRoot, "loose-file")))
    assert.equal((await selectSummary("storageGc")).deletedOrphanObjects, 2)
    assert.equal((await selectSummary("storageGc")).deletedStaleAssets, 1)
  })

  test("orphan gc does not touch old upload staging debris", async () => {
    const registration = registry.getJobKind("storage.orphan-gc")
    assert.ok(registration)
    const clipId = crypto.randomUUID()
    const uploadKey = `uploads/${clipId}/source.mp4`

    await storage.clipStorage.put(uploadKey, bytes(), "video/mp4")
    await setClipMtime(uploadKey, oldDate)

    await registration.handler({}, contextFor())

    assert.ok(await storage.clipStorage.resolve(uploadKey))
  })

  test("aborted orphan gc writes no summary record", async () => {
    const registration = registry.getJobKind("storage.orphan-gc")
    assert.ok(registration)
    const controller = new AbortController()
    controller.abort()

    await registration.handler({}, contextFor(controller.signal))

    assert.equal(await selectSummaryOrNull("storageGc"), null)
  })

  async function insertClip(): Promise<string> {
    const clipId = crypto.randomUUID()
    const userId = crypto.randomUUID()
    await database.db.insert(authSchema.user).values({
      id: userId,
      email: `${clipId}@example.test`,
      username: `user-${clipId.slice(0, 8)}`,
      display_name: `User ${clipId.slice(0, 8)}`,
    })
    await database.db.insert(schema.clip).values({
      id: clipId,
      author_id: userId,
      title: "Test clip",
      status: "ready",
      source_content_type: defaultFacts().sourceContentType,
      source_codecs: defaultFacts().sourceCodecs,
      source_fps: defaultFacts().sourceFps,
      height: defaultFacts().height,
      trim_start_ms: defaultFacts().trimStartMs,
      trim_end_ms: defaultFacts().trimEndMs,
      encode_fingerprint: expectedFingerprint(),
      encode_progress: 100,
    })
    return clipId
  }

  function rendition(clipId: string, name: string, storageKey: string) {
    return {
      clip_id: clipId,
      name,
      is_og: name === "720p",
      height: name === "720p" ? 720 : 480,
      width: name === "720p" ? 1280 : 854,
      fps: 60,
      storage_key: storageKey,
      codecs: "avc1.64002a,mp4a.40.2",
      size_bytes: 1,
    }
  }

  async function renditionNames(clipId: string): Promise<string[]> {
    const rows = await database.db
      .select({ name: schema.clipRendition.name })
      .from(schema.clipRendition)
      .where(drizzle.eq(schema.clipRendition.clip_id, clipId))
      .orderBy(schema.clipRendition.name)
    return rows.map((row) => row.name)
  }

  async function clipEncodeJobs() {
    return database.db
      .select({
        dedupKey: schema.job.dedup_key,
        priority: schema.job.priority,
        payload: schema.job.payload,
      })
      .from(schema.job)
      .where(drizzle.eq(schema.job.kind, "clip.encode"))
      .orderBy(schema.job.dedup_key)
  }

  async function selectClip(clipId: string) {
    const [row] = await database.db
      .select({
        status: schema.clip.status,
        cutKey: schema.clip.cut_key,
        encodeFingerprint: schema.clip.encode_fingerprint,
        encodeFailedFingerprint: schema.clip.encode_failed_fingerprint,
        failureReason: schema.clip.failure_reason,
      })
      .from(schema.clip)
      .where(drizzle.eq(schema.clip.id, clipId))
      .limit(1)
    return row ?? null
  }

  async function selectRawClip(clipId: string) {
    const [row] = await database.db
      .select()
      .from(schema.clip)
      .where(drizzle.eq(schema.clip.id, clipId))
      .limit(1)
    return row ?? null
  }

  async function selectSummary(key: string): Promise<Record<string, number>> {
    const [row] = await database.db
      .select({ value: schema.instanceSetting.value })
      .from(schema.instanceSetting)
      .where(drizzle.eq(schema.instanceSetting.key, key))
      .limit(1)
    assert.ok(row)
    return row.value as Record<string, number>
  }

  async function selectSummaryOrNull(key: string): Promise<unknown | null> {
    const [row] = await database.db
      .select({ value: schema.instanceSetting.value })
      .from(schema.instanceSetting)
      .where(drizzle.eq(schema.instanceSetting.key, key))
      .limit(1)
    return row?.value ?? null
  }

  function expectedFingerprint(): string {
    return fingerprint.encodeFingerprint(config, defaultFacts())
  }

  function defaultFacts() {
    return {
      height: 1080,
      sourceFps: 60,
      sourceContentType: "video/mp4",
      sourceCodecs: "avc1.64002A,mp4a.40.2",
      trimStartMs: null,
      trimEndMs: null,
    }
  }

  function runId(stamp: string): string {
    return `${stamp.slice(0, 8)}-${stamp.slice(8, 12)}-4000-8000-000000000000`
  }

  function bytes(): Uint8Array {
    return new Uint8Array([1, 2, 3])
  }

  function setClipMtime(key: string, date: Date): Promise<void> {
    return utimes(join(clipsRoot, key), date, date)
  }

  function setThumbMtime(key: string, date: Date): Promise<void> {
    return utimes(join(thumbnailsRoot, key), date, date)
  }

  async function fileExists(path: string): Promise<boolean> {
    const result = await stat(path).catch((err) => {
      if ((err as { code?: string } | null)?.code === "ENOENT") return null
      throw err
    })
    return result !== null
  }

  function contextFor(signal = new AbortController().signal) {
    return {
      signal,
      attempt: 1,
      jobId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      setProgress() {},
    }
  }
}
