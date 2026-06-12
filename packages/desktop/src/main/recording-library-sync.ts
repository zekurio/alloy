import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { extname, dirname, join } from "node:path"

import type {
  InitiateClipInput,
  RecordingLibraryItem,
  RecordingLibrarySyncItem,
  RecordingLibrarySyncSnapshot,
} from "@alloy/contracts"
import { logger } from "@alloy/logging"
import { app } from "electron"

import { ensureDeviceRegistered } from "./device-identity"
import {
  deleteClip,
  failClip,
  finalizeClip,
  hasSessionCookie,
  initiateClip,
  MainApiError,
  uploadFileToTicket,
  upsertGameSession,
} from "./main-api"
import { emitRecordingLibrarySyncEvent, onRecordingEvent } from "./recording"
import { readCaptureManifest, manifestKey } from "./recording-library-manifest"
import {
  findRecordingLibraryItem,
  getRecordingLibrarySnapshot,
} from "./recording-library-scan"
import { updateRecordingLibraryCaptureMeta } from "./recording-library-store"
import { setSyncRegistryStatuses } from "./recording-library-sync-registry"
import { cachedRecordingThumbnail } from "./recording-library-thumbnails"
import {
  getLocalGameSession,
  markGameSessionSynced,
  onGameSessionEnded,
  type LocalGameSession,
} from "./recording-session-tracker"
import { getRecordingSettings, getStartupServerUrl } from "./server-store"

/**
 * The upload half of library sync: a persistent, pausable queue of local
 * replay captures heading to the server as private clips. Mirrors the clip
 * download manager (jobs map, abort, 200ms progress throttle) but survives
 * restarts via {userData}/sync-queue.json. One transfer at a time — these are
 * large files on a gaming machine.
 */

interface SyncJob {
  item: RecordingLibrarySyncItem
  abort: AbortController | null
}

interface SyncQueueFile {
  version: 1
  paused: boolean
  items: Record<
    string,
    Pick<
      RecordingLibrarySyncItem,
      | "captureId"
      | "gameSessionId"
      | "queuedAt"
      | "attempts"
      | "error"
      | "clipId"
    > & { status: "queued" | "failed" }
  >
}

const PROGRESS_EMIT_INTERVAL_MS = 200
const MAX_AUTO_ATTEMPTS = 5

const jobs = new Map<string, SyncJob>()
let paused = false
let blockedReason: RecordingLibrarySyncSnapshot["blockedReason"] = null
let pumping = false

/** Load persisted queue state and hook the session/capture triggers. */
export function registerRecordingLibrarySync(): void {
  loadQueue()

  onGameSessionEnded((session) => {
    void handleSessionEnded(session)
  })

  // Replay saves can finalize after their game (and its session) already
  // ended — pick those up as their manifest entry lands.
  onRecordingEvent((event) => {
    if (event.type !== "capture-ready") return
    if (!getRecordingSettings().autoSyncAfterGaming) return
    const manifest = readCaptureManifest()
    const entry = manifest.captures[manifestKey(event.capture.filename)]
    const sessionId = entry?.gameSessionId ?? null
    if (!sessionId || entry?.uploadedClipId) return
    const session = getLocalGameSession(sessionId)
    if (!session || session.endedAt === null) return
    const item = findRecordingLibraryItem(event.capture.id)
    if (item && enqueueItem(item)) {
      persistQueue()
      publishSnapshot()
      void pumpRecordingLibrarySync()
    }
  })
}

export function getRecordingLibrarySyncSnapshot(): RecordingLibrarySyncSnapshot {
  return {
    paused,
    blockedReason,
    items: [...jobs.values()]
      .map((job) => ({ ...job.item }))
      .sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt)),
  }
}

export function pauseRecordingLibrarySync(): RecordingLibrarySyncSnapshot {
  if (!paused) {
    paused = true
    // The in-flight transfer aborts and returns to the queue; presigned
    // uploads aren't resumable, so it restarts from zero later.
    for (const job of jobs.values()) {
      if (job.abort && job.item.status === "uploading") job.abort.abort()
    }
    persistQueue()
    publishSnapshot()
  }
  return getRecordingLibrarySyncSnapshot()
}

export function resumeRecordingLibrarySync(): RecordingLibrarySyncSnapshot {
  if (paused) {
    paused = false
    persistQueue()
    publishSnapshot()
    void pumpRecordingLibrarySync()
  }
  return getRecordingLibrarySyncSnapshot()
}

export function cancelRecordingLibrarySyncItem(captureId: string): void {
  const job = jobs.get(captureId)
  if (!job) return
  const clipId = job.item.clipId
  jobs.delete(captureId)
  job.abort?.abort()
  // A pending server row would sit as a phantom in the user's queue.
  if (clipId) {
    const serverUrl = getStartupServerUrl()
    if (serverUrl) {
      void deleteClip(serverUrl, clipId).catch(() => undefined)
    }
  }
  persistQueue()
  publishSnapshot()
}

export function retryRecordingLibrarySyncItem(captureId: string): void {
  const job = jobs.get(captureId)
  if (!job || job.item.status !== "failed") return
  job.item.status = "queued"
  job.item.error = null
  job.item.bytesSent = 0
  persistQueue()
  publishSnapshot()
  void pumpRecordingLibrarySync()
}

/** Manual "Sync now" for a single library capture. */
export function queueRecordingLibrarySyncItem(captureId: string): void {
  const item = findRecordingLibraryItem(captureId)
  if (!item) throw new Error("Capture not found.")
  if (item.uploadedClipId) throw new Error("Capture is already synced.")
  if (item.kind !== "replay") {
    throw new Error("Only clips can sync to the server.")
  }
  if (extname(item.filename).toLowerCase() !== ".mp4") {
    throw new Error("Only mp4 clips can sync to the server.")
  }
  if (!item.gameName) {
    throw new Error("No game detected for this clip — publish it manually.")
  }
  if (enqueueItem(item)) {
    persistQueue()
    publishSnapshot()
  }
  void pumpRecordingLibrarySync()
}

/** Re-queue failed items (bounded) and drain. Called on login/startup. */
export function kickRecordingLibrarySync(): void {
  let mutated = false
  for (const job of jobs.values()) {
    if (job.item.status !== "failed") continue
    if (job.item.attempts >= MAX_AUTO_ATTEMPTS) continue
    job.item.status = "queued"
    job.item.error = null
    job.item.bytesSent = 0
    mutated = true
  }
  if (mutated) {
    persistQueue()
    publishSnapshot()
  }
  void pumpRecordingLibrarySync()
}

async function handleSessionEnded(session: LocalGameSession): Promise<void> {
  if (!getRecordingSettings().autoSyncAfterGaming) return

  const manifest = readCaptureManifest()
  let mutated = false
  for (const item of getRecordingLibrarySnapshot().items) {
    if (item.kind !== "replay") continue
    if (item.uploadedClipId) continue
    if (extname(item.filename).toLowerCase() !== ".mp4") continue
    const entry = manifest.captures[manifestKey(item.filename)]
    if (entry?.gameSessionId !== session.id) continue
    if (enqueueItem(item)) mutated = true
  }
  if (mutated) {
    persistQueue()
    publishSnapshot()
  }
  kickRecordingLibrarySync()
}

function enqueueItem(item: RecordingLibraryItem): boolean {
  const existing = jobs.get(item.id)
  if (existing) return false

  const manifest = readCaptureManifest()
  const entry = manifest.captures[manifestKey(item.filename)]
  jobs.set(item.id, {
    item: {
      captureId: item.id,
      title: item.title,
      gameName: item.gameName,
      status: "queued",
      bytesSent: 0,
      totalBytes: item.sizeBytes,
      clipId: null,
      error: null,
      attempts: 0,
      queuedAt: new Date().toISOString(),
      gameSessionId: entry?.gameSessionId ?? null,
      thumbnailUrl: item.thumbnailUrl,
    },
    abort: null,
  })
  return true
}

export async function pumpRecordingLibrarySync(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (!paused) {
      const job = nextQueuedJob()
      if (!job) break

      const serverUrl = getStartupServerUrl()
      if (!serverUrl) break
      if (!(await hasSessionCookie(serverUrl))) {
        setBlockedReason("signed-out")
        break
      }
      setBlockedReason(null)
      await runSyncJob(serverUrl, job)
    }
  } finally {
    pumping = false
  }
}

function nextQueuedJob(): SyncJob | null {
  let next: SyncJob | null = null
  for (const job of jobs.values()) {
    if (job.item.status !== "queued") continue
    if (
      !next ||
      Date.parse(job.item.queuedAt) < Date.parse(next.item.queuedAt)
    ) {
      next = job
    }
  }
  return next
}

async function runSyncJob(serverUrl: string, job: SyncJob): Promise<void> {
  const item = job.item
  const capture = findRecordingLibraryItem(item.captureId)
  if (!capture) {
    jobs.delete(item.captureId)
    persistQueue()
    publishSnapshot()
    return
  }
  if (capture.uploadedClipId) {
    jobs.delete(item.captureId)
    persistQueue()
    publishSnapshot()
    return
  }

  job.abort = new AbortController()
  let clipId: string | null = null
  try {
    item.status = "initiating"
    publishSnapshot()

    const deviceId = await ensureDeviceRegistered(serverUrl)
    const sessionId = await ensureSessionSynced(
      serverUrl,
      deviceId,
      item.gameSessionId,
    )

    const initiate = await initiateClip(
      serverUrl,
      buildInitiateInput(capture, deviceId, sessionId),
    )
    clipId = initiate.clipId
    item.clipId = clipId
    item.status = "uploading"
    item.bytesSent = 0
    item.totalBytes = capture.sizeBytes
    publishSnapshot()

    let lastEmitAt = 0
    await uploadFileToTicket(
      initiate.ticket,
      capture.filename,
      (sentBytes, totalBytes) => {
        item.bytesSent = sentBytes
        item.totalBytes = totalBytes
        const now = Date.now()
        if (now - lastEmitAt >= PROGRESS_EMIT_INTERVAL_MS) {
          lastEmitAt = now
          emitRecordingLibrarySyncEvent(getRecordingLibrarySyncSnapshot())
        }
      },
      job.abort.signal,
    )

    // The cached JPEG poster, when the renderer produced one. Best-effort:
    // a clip without a published thumbnail still works (blurhash fallback).
    const poster = cachedRecordingThumbnail(capture)
    if (poster) {
      try {
        await uploadFileToTicket(
          initiate.thumbTicket,
          poster,
          () => undefined,
          job.abort.signal,
        )
      } catch (cause) {
        if (job.abort.signal.aborted) throw cause
        logger.warn(
          `[desktop] poster upload failed for ${item.captureId}:`,
          cause,
        )
      }
    }

    item.status = "finalizing"
    publishSnapshot()
    await finalizeClip(serverUrl, clipId)

    updateRecordingLibraryCaptureMeta({
      id: item.captureId,
      uploadedClipId: clipId,
    })
    item.status = "completed"
    publishSnapshot()
    // The server queue row (pending → processing → ready) takes over the
    // story in the Sync UI from here.
    jobs.delete(item.captureId)
    persistQueue()
    publishSnapshot()
  } catch (cause) {
    const canceled = !jobs.has(item.captureId)
    if (canceled) return

    if (paused && job.abort?.signal.aborted) {
      // Pause aborted the transfer; the partial server clip can't resume, so
      // drop it and restart this item from zero later.
      item.status = "queued"
      item.bytesSent = 0
      item.clipId = null
      if (clipId) void failClip(serverUrl, clipId).catch(() => undefined)
      persistQueue()
      publishSnapshot()
      return
    }

    item.status = "failed"
    item.attempts += 1
    item.error = syncErrorMessage(cause)
    item.bytesSent = 0
    item.clipId = null
    if (clipId) void failClip(serverUrl, clipId).catch(() => undefined)
    persistQueue()
    publishSnapshot()
  } finally {
    job.abort = null
  }
}

/**
 * Make sure the play session row exists server-side before clips reference
 * it. Returns the session id to attach, or null when the local record is
 * gone (sync the clip without a session rather than failing it).
 */
async function ensureSessionSynced(
  serverUrl: string,
  deviceId: string,
  sessionId: string | null,
): Promise<string | null> {
  if (!sessionId) return null
  const session = getLocalGameSession(sessionId)
  if (!session) return null
  if (session.syncedToServer) return sessionId

  await upsertGameSession(serverUrl, sessionId, {
    deviceId,
    gameName: session.gameName,
    startedAt: session.startedAt,
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
  })
  markGameSessionSynced(sessionId)
  return sessionId
}

function buildInitiateInput(
  capture: RecordingLibraryItem,
  deviceId: string,
  sessionId: string | null,
): InitiateClipInput {
  return {
    filename: capture.fileName,
    contentType: "video/mp4",
    sizeBytes: capture.sizeBytes,
    title: capture.title,
    description: capture.description ?? undefined,
    gameName: capture.gameName ?? undefined,
    // Auto-synced clips are a private cloud backup; publishing is a
    // deliberate later step through the regular edit flow.
    privacy: "private",
    mentionedUserIds: capture.mentions.map((mention) => mention.id),
    tags: parseDraftTags(capture.tags),
    thumbBlurHash: capture.thumbBlurHash ?? undefined,
    thumbContentType: "image/jpeg",
    originDeviceId: deviceId,
    gameSessionId: sessionId ?? undefined,
  }
}

/** Draft tags are free text ("#ace ranked"); the server normalizes properly. */
function parseDraftTags(tags: string | null): string[] | undefined {
  if (!tags) return undefined
  const parsed = tags
    .split(/[\s,]+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 10)
  return parsed.length > 0 ? parsed : undefined
}

function syncErrorMessage(cause: unknown): string {
  if (cause instanceof MainApiError) {
    if (cause.message === "game-unresolved") {
      return "Couldn't match the game — publish this clip manually to pick one."
    }
    return cause.message
  }
  return cause instanceof Error ? cause.message : "Sync failed."
}

function setBlockedReason(
  reason: RecordingLibrarySyncSnapshot["blockedReason"],
): void {
  if (blockedReason === reason) return
  blockedReason = reason
  publishSnapshot()
}

function publishSnapshot(): void {
  setSyncRegistryStatuses(
    [...jobs.values()].map((job) => [job.item.captureId, job.item.status]),
  )
  emitRecordingLibrarySyncEvent(getRecordingLibrarySyncSnapshot())
}

function loadQueue(): void {
  try {
    const parsed: unknown = JSON.parse(readFileSync(queuePath(), "utf8"))
    const record = parsed as SyncQueueFile | null
    if (record?.version !== 1 || typeof record.items !== "object") return
    paused = record.paused === true
    for (const persisted of Object.values(record.items)) {
      if (typeof persisted?.captureId !== "string") continue
      jobs.set(persisted.captureId, {
        item: {
          captureId: persisted.captureId,
          title: persisted.captureId,
          gameName: null,
          status: persisted.status === "failed" ? "failed" : "queued",
          bytesSent: 0,
          totalBytes: 0,
          clipId: null,
          error: persisted.error ?? null,
          attempts: persisted.attempts ?? 0,
          queuedAt: persisted.queuedAt ?? new Date().toISOString(),
          gameSessionId: persisted.gameSessionId ?? null,
          thumbnailUrl: null,
        },
        abort: null,
      })
      // An interrupted transfer left a pending server clip; clean it up so
      // the retry starts fresh.
      if (persisted.clipId) {
        const serverUrl = getStartupServerUrl()
        if (serverUrl) {
          void failClip(serverUrl, persisted.clipId).catch(() => undefined)
        }
      }
    }
    rehydrateItems()
  } catch {
    // Missing or corrupt queue file — start clean.
  }
  publishSnapshot()
}

/** Refresh display fields (title, thumbnail, size) from the live library. */
function rehydrateItems(): void {
  for (const job of jobs.values()) {
    const item = findRecordingLibraryItem(job.item.captureId)
    if (!item) {
      jobs.delete(job.item.captureId)
      continue
    }
    if (item.uploadedClipId) {
      jobs.delete(job.item.captureId)
      continue
    }
    job.item.title = item.title
    job.item.gameName = item.gameName
    job.item.totalBytes = item.sizeBytes
    job.item.thumbnailUrl = item.thumbnailUrl
  }
  persistQueue()
}

function persistQueue(): void {
  const file: SyncQueueFile = {
    version: 1,
    paused,
    items: Object.fromEntries(
      [...jobs.values()].map((job) => [
        job.item.captureId,
        {
          captureId: job.item.captureId,
          gameSessionId: job.item.gameSessionId,
          queuedAt: job.item.queuedAt,
          attempts: job.item.attempts,
          error: job.item.status === "failed" ? job.item.error : null,
          // Transient states persist as their resting equivalent; an
          // in-flight clipId is kept so restart recovery can fail it.
          status: job.item.status === "failed" ? "failed" : "queued",
          clipId: job.item.clipId,
        },
      ]),
    ),
  }
  try {
    const path = queuePath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`)
  } catch (cause) {
    logger.warn("[desktop] failed to persist sync queue:", cause)
  }
}

function queuePath(): string {
  return join(app.getPath("userData"), "sync-queue.json")
}
