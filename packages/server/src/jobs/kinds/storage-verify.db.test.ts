import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, beforeEach, test } from "node:test"

import { TranscodingConfigSchema } from "@alloy/contracts"
import { user } from "@alloy/db/auth-schema"
import { clip, clipRendition, instanceSetting, job } from "@alloy/db/schema"
import { deleteClipRowAndAssets } from "@alloy/server/clips/delete"
import { client, db } from "@alloy/server/db/index"
import { prepareTestDatabase } from "@alloy/server/db/test-database"
import { encodeFingerprint } from "@alloy/server/media/encode-fingerprint"
import {
  runScopedCutKey,
  runScopedRenditionKey,
  runScopedSourceKey,
  runScopedThumbKey,
} from "@alloy/server/queue/media-asset-keys"
import { clipAssetDir, clipAssetKey } from "@alloy/server/storage/driver"
import { clipStorage, clipThumbnailStorage } from "@alloy/server/storage/index"
import { eq } from "drizzle-orm"

import { getJobKind } from "../registry"
import { verifyClipAssets } from "./storage-verify"

const storageRoot = await mkdtemp(join(tmpdir(), "alloy-storage-verify-"))
const clipsRoot = join(storageRoot, "clips")
const thumbnailsRoot = join(storageRoot, "thumbnails")
process.env.ALLOY_STORAGE_FS_CLIPS_PATH = clipsRoot
process.env.ALLOY_STORAGE_FS_THUMBNAILS_PATH = thumbnailsRoot
process.env.ALLOY_STORAGE_FS_ASSETS_PATH = join(storageRoot, "assets")
await prepareTestDatabase("storage-verify")

const config = TranscodingConfigSchema.parse({})
const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)

after(async () => {
  await client.end()
  await rm(storageRoot, { recursive: true, force: true })
})

beforeEach(async () => {
  await db.delete(job)
  await db.delete(clip)
  await db.delete(user)
  await db.delete(instanceSetting)
  await rm(clipsRoot, { recursive: true, force: true })
  await rm(thumbnailsRoot, { recursive: true, force: true })
  await mkdir(clipsRoot, { recursive: true })
  await mkdir(thumbnailsRoot, { recursive: true })
})

test("missing rendition row is deleted and repair encode is enqueued", async () => {
  const clipId = await insertClip()
  const sourceKey = runScopedSourceKey(clipId, runId("111111111111"))
  const presentKey = runScopedRenditionKey(
    clipId,
    runId("222222222222"),
    "720p",
  )
  const missingKey = runScopedRenditionKey(
    clipId,
    runId("333333333333"),
    "480p",
  )
  await clipStorage.put(sourceKey, bytes(), "video/mp4")
  await clipStorage.put(presentKey, bytes(), "video/mp4")
  await db
    .update(clip)
    .set({
      source_key: sourceKey,
      encode_fingerprint: expectedFingerprint(),
    })
    .where(eq(clip.id, clipId))
  await db
    .insert(clipRendition)
    .values([
      rendition(clipId, "720p", presentKey),
      rendition(clipId, "480p", missingKey),
    ])

  const summary = await verifyClipAssets(clipId)

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
  const sourceKey = runScopedSourceKey(clipId, runId("444444444444"))
  const cutKey = runScopedCutKey(clipId, runId("555555555555"))
  await clipStorage.put(sourceKey, bytes(), "video/mp4")
  await db
    .update(clip)
    .set({
      source_key: sourceKey,
      cut_key: cutKey,
      encode_fingerprint: expectedFingerprint(),
      encode_run_id: crypto.randomUUID(),
    })
    .where(eq(clip.id, clipId))

  const summary = await verifyClipAssets(clipId)
  const row = await selectClip(clipId)

  assert.equal(summary.missingCuts, 1)
  assert.equal(summary.repaired, 0)
  assert.equal(row?.cutKey, cutKey)
  assert.equal(row?.encodeFingerprint, expectedFingerprint())
  assert.deepEqual(await clipEncodeJobs(), [])
})

test("missing source quarantines while surviving renditions keep status ready", async () => {
  const clipId = await insertClip()
  const sourceKey = runScopedSourceKey(clipId, runId("666666666666"))
  const renditionKey = runScopedRenditionKey(
    clipId,
    runId("777777777777"),
    "720p",
  )
  await clipStorage.put(renditionKey, bytes(), "video/mp4")
  await db
    .update(clip)
    .set({
      source_key: sourceKey,
      encode_fingerprint: expectedFingerprint(),
    })
    .where(eq(clip.id, clipId))
  await db.insert(clipRendition).values(rendition(clipId, "720p", renditionKey))

  const summary = await verifyClipAssets(clipId)
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
  await db
    .update(clip)
    .set({
      source_key: runScopedSourceKey(clipId, runId("888888888888")),
      encode_fingerprint: expectedFingerprint(),
    })
    .where(eq(clip.id, clipId))

  const summary = await verifyClipAssets(clipId)
  const row = await selectClip(clipId)

  assert.equal(summary.missingSources, 1)
  assert.equal(summary.repaired, 1)
  assert.equal(row?.status, "failed")
  assert.equal(row?.failureReason, "source bytes missing from storage")
})

test("deleteClipRowAndAssets removes rendition files", async () => {
  const clipId = await insertClip()
  const sourceKey = runScopedSourceKey(clipId, runId("999999999999"))
  const thumbKey = runScopedThumbKey(clipId, runId("aaaaaaaaaaaa"))
  const renditionKey = runScopedRenditionKey(
    clipId,
    runId("bbbbbbbbbbbb"),
    "720p",
  )
  await clipStorage.put(sourceKey, bytes(), "video/mp4")
  await clipThumbnailStorage.put(thumbKey, bytes(), "image/jpeg")
  await clipThumbnailStorage.put(
    clipAssetKey(clipId, "scrubber"),
    bytes(),
    "image/jpeg",
  )
  await clipStorage.put(renditionKey, bytes(), "video/mp4")
  await db
    .update(clip)
    .set({ source_key: sourceKey, thumb_key: thumbKey })
    .where(eq(clip.id, clipId))
  await db.insert(clipRendition).values(rendition(clipId, "720p", renditionKey))
  const row = await selectRawClip(clipId)
  assert.ok(row)

  await deleteClipRowAndAssets(row)

  assert.equal(await clipStorage.resolve(sourceKey), null)
  assert.equal(await clipStorage.resolve(renditionKey), null)
  assert.equal(await clipThumbnailStorage.resolve(thumbKey), null)
  assert.equal(
    await clipThumbnailStorage.resolve(clipAssetKey(clipId, "scrubber")),
    null,
  )
})

test("orphan gc removes only old orphan and stale run-stamped assets", async () => {
  const registration = getJobKind("storage.orphan-gc")
  assert.ok(registration)
  const existingClipId = await insertClip()
  const orphanOldId = crypto.randomUUID()
  const orphanYoungId = crypto.randomUUID()
  const orphanThumbId = crypto.randomUUID()
  const liveSource = runScopedSourceKey(existingClipId, runId("cccccccccccc"))
  const staleAsset = runScopedRenditionKey(
    existingClipId,
    runId("dddddddddddd"),
    "720p",
  )
  const youngAsset = runScopedCutKey(existingClipId, runId("eeeeeeeeeeee"))
  const unknownAsset = `${clipAssetDir(existingClipId)}/notes.txt`
  const orphanOld = runScopedSourceKey(orphanOldId, runId("abababababab"))
  const orphanYoung = runScopedSourceKey(orphanYoungId, runId("bcbcbcbcbcbc"))
  const orphanThumb = runScopedThumbKey(orphanThumbId, runId("cdcdcdcdcdcd"))

  await clipStorage.put(liveSource, bytes(), "video/mp4")
  await clipStorage.put(staleAsset, bytes(), "video/mp4")
  await clipStorage.put(youngAsset, bytes(), "video/mp4")
  await clipStorage.put(unknownAsset, bytes(), "text/plain")
  await clipStorage.put(orphanOld, bytes(), "video/mp4")
  await clipStorage.put(orphanYoung, bytes(), "video/mp4")
  await clipThumbnailStorage.put(orphanThumb, bytes(), "image/jpeg")
  await mkdir(clipsRoot, { recursive: true })
  await writeFile(join(clipsRoot, "loose-file"), "unknown")
  await Promise.all([
    setClipMtime(staleAsset, oldDate),
    setClipMtime(unknownAsset, oldDate),
    setClipMtime(orphanOld, oldDate),
    setThumbMtime(orphanThumb, oldDate),
    utimes(join(clipsRoot, "loose-file"), oldDate, oldDate),
  ])
  await db
    .update(clip)
    .set({ source_key: liveSource })
    .where(eq(clip.id, existingClipId))

  await registration.handler({}, contextFor())

  assert.ok(await clipStorage.resolve(liveSource))
  assert.equal(await clipStorage.resolve(staleAsset), null)
  assert.ok(await clipStorage.resolve(youngAsset))
  assert.ok(await clipStorage.resolve(unknownAsset))
  assert.equal(await clipStorage.resolve(orphanOld), null)
  assert.ok(await clipStorage.resolve(orphanYoung))
  assert.equal(await clipThumbnailStorage.resolve(orphanThumb), null)
  assert.ok(await fileExists(join(clipsRoot, "loose-file")))
  assert.equal((await selectSummary("storageGc")).deletedOrphanObjects, 2)
  assert.equal((await selectSummary("storageGc")).deletedStaleAssets, 1)
})

test("orphan gc does not touch old upload staging debris", async () => {
  const registration = getJobKind("storage.orphan-gc")
  assert.ok(registration)
  const clipId = crypto.randomUUID()
  const uploadKey = `uploads/${clipId}/source.mp4`

  await clipStorage.put(uploadKey, bytes(), "video/mp4")
  await setClipMtime(uploadKey, oldDate)

  await registration.handler({}, contextFor())

  assert.ok(await clipStorage.resolve(uploadKey))
})

test("aborted orphan gc writes no summary record", async () => {
  const registration = getJobKind("storage.orphan-gc")
  assert.ok(registration)
  const controller = new AbortController()
  controller.abort()

  await registration.handler({}, contextFor(controller.signal))

  assert.equal(await selectSummaryOrNull("storageGc"), null)
})

async function insertClip(): Promise<string> {
  const clipId = crypto.randomUUID()
  const userId = crypto.randomUUID()
  await db.insert(user).values({
    id: userId,
    email: `${clipId}@example.test`,
    username: `user-${clipId.slice(0, 8)}`,
  })
  await db.insert(clip).values({
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
  const rows = await db
    .select({ name: clipRendition.name })
    .from(clipRendition)
    .where(eq(clipRendition.clip_id, clipId))
    .orderBy(clipRendition.name)
  return rows.map((row) => row.name)
}

async function clipEncodeJobs() {
  return db
    .select({
      dedupKey: job.dedup_key,
      priority: job.priority,
      payload: job.payload,
    })
    .from(job)
    .where(eq(job.kind, "clip.encode"))
    .orderBy(job.dedup_key)
}

async function selectClip(clipId: string) {
  const [row] = await db
    .select({
      status: clip.status,
      cutKey: clip.cut_key,
      encodeFingerprint: clip.encode_fingerprint,
      encodeFailedFingerprint: clip.encode_failed_fingerprint,
      failureReason: clip.failure_reason,
    })
    .from(clip)
    .where(eq(clip.id, clipId))
    .limit(1)
  return row ?? null
}

async function selectRawClip(clipId: string) {
  const [row] = await db.select().from(clip).where(eq(clip.id, clipId)).limit(1)
  return row ?? null
}

async function selectSummary(key: string): Promise<Record<string, number>> {
  const [row] = await db
    .select({ value: instanceSetting.value })
    .from(instanceSetting)
    .where(eq(instanceSetting.key, key))
    .limit(1)
  assert.ok(row)
  return row.value as Record<string, number>
}

async function selectSummaryOrNull(key: string): Promise<unknown | null> {
  const [row] = await db
    .select({ value: instanceSetting.value })
    .from(instanceSetting)
    .where(eq(instanceSetting.key, key))
    .limit(1)
  return row?.value ?? null
}

function expectedFingerprint(): string {
  return encodeFingerprint(config, defaultFacts())
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
