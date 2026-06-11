import { createHash, randomUUID } from "node:crypto"
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  type Dirent,
  type Stats,
  writeFileSync,
} from "node:fs"
import { basename, dirname, extname, join, relative, resolve } from "node:path"
import { Readable } from "node:stream"
import { pathToFileURL } from "node:url"

import type {
  RecordingCapture,
  RecordingCaptureKind,
  RecordingCaptureSource,
} from "alloy-contracts"
import { logger } from "alloy-logging"
import { app, net, shell } from "electron"

import type {
  RecordingCaptureMention,
  RecordingLibraryExportRequest,
  RecordingLibraryExportSegment,
  RecordingLibraryGroup,
  RecordingLibraryImportRequest,
  RecordingLibraryImportResult,
  RecordingLibraryItem,
  RecordingLibraryMetaPatch,
  RecordingLibraryProject,
  RecordingLibraryProjectDraft,
  RecordingLibraryProjectDraftSaveRequest,
  RecordingLibraryProjectDraftSaveResult,
  RecordingLibrarySnapshot,
} from "../shared/ipc"
import { cachedAssetUrl } from "./asset-cache"
import { runFfmpeg, runFfprobe } from "./ffmpeg"
import { imageFileBlurHash } from "./image-blurhash"
import {
  currentOutputFolder,
  defaultScreenshotFolder,
} from "./recording-storage"
import {
  getThumbnailBlurHash,
  pruneThumbnailBlurHashes,
  rememberThumbnailBlurHash,
} from "./recording-thumbnail-meta"
import { mainSession } from "./session"

const MEDIA_PROTOCOL = "alloy-capture"
const MEDIA_HOST = "media"
const THUMBNAIL_HOST = "thumbnail"
const FILMSTRIP_HOST = "filmstrip"
const EXPORT_HOST = "export"
/** Frames sampled per capture for the editor timeline filmstrip. */
const FILMSTRIP_FRAME_COUNT = 16
const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".mov", ".webm"])
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"])
const exportedCaptureFiles = new Map<string, string>()

type LibraryCollection = RecordingLibraryItem["collection"]

interface CollectionScan {
  root: string
  collection: LibraryCollection
  kind: RecordingCaptureKind
}

interface CaptureManifest {
  version: 1
  captures: Record<string, CaptureManifestEntry>
  projectDrafts: Record<string, RecordingLibraryProjectDraft>
}

interface CaptureManifestEntry {
  filename: string
  title: string
  kind: RecordingCaptureKind
  source: RecordingCaptureSource
  gameName: string | null
  gameIconUrl: string | null
  sizeBytes: number | null
  durationMs: number | null
  width: number | null
  height: number | null
  createdAt: string
  updatedAt: string
  /**
   * Draft upload metadata edited in the library. Optional so manifests
   * written before these fields existed keep parsing.
   */
  description?: string | null
  tags?: string | null
  mentions?: RecordingCaptureMention[]
  privacy?: RecordingLibraryItem["privacy"]
}

export function recordingLibraryProtocolScheme(): Electron.CustomScheme {
  return {
    scheme: MEDIA_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      // Without this, the scheme is missing from Chromium's CORS-enabled
      // scheme list and any cross-origin fetch() from the web app fails
      // outright with "Failed to fetch" — the request never reaches the
      // handler. The editor's mediabunny reader fetches capture bytes.
      corsEnabled: true,
    },
  }
}

let mediaProtocolRegistered = false

export function registerRecordingLibraryProtocol(): void {
  if (mediaProtocolRegistered) return
  mediaProtocolRegistered = true

  mainSession().protocol.handle(MEDIA_PROTOCOL, async (request) => {
    // The web app's editor reads captures with fetch() + Range headers
    // (mediabunny), which sends a cross-origin preflight first — media
    // elements skip it, fetch doesn't.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      })
    }

    const route = captureRouteFromUrl(request.url)
    if (!route) return new Response("Not found", { status: 404 })

    const item =
      route.kind === "export" ? null : findRecordingLibraryItem(route.id)

    if (route.kind === "export") {
      const filename = exportedCaptureFiles.get(route.id)
      if (!filename || !existsSync(filename)) {
        return new Response("Not found", { status: 404 })
      }
      return rangedFileResponse(filename, request)
    }

    if (!item) return new Response("Not found", { status: 404 })

    if (route.kind === "thumbnail") {
      const thumbnail = await ensureRecordingThumbnail(item)
      if (!thumbnail) return new Response("Not found", { status: 404 })
      // The thumbnail bytes are already on disk; derive the BlurHash off the
      // request path so the next library snapshot can ship a placeholder.
      void ensureCaptureBlurHash(item)
      return net.fetch(pathToFileURL(thumbnail).toString())
    }

    if (route.kind === "filmstrip") {
      const frame = await ensureRecordingFilmstripFrame(item, route.frameIndex)
      if (!frame) return new Response("Not found", { status: 404 })
      return net.fetch(pathToFileURL(frame).toString())
    }

    // Screenshots are their own thumbnail, so the first media request is the
    // natural point to derive their BlurHash.
    if (item.kind === "screenshot") void ensureCaptureBlurHash(item)
    return rangedFileResponse(item.filename, request)
  })
}

const CAPTURE_CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
}

/**
 * Serves a capture file with HTTP Range support. `net.fetch(file://…)`
 * ignores Range headers, so every seek of Chromium's media element (and the
 * editor's filmstrip sampler) would restart a full-file stream — large
 * captures stall and the element eventually gives up with
 * MEDIA_ERR_SRC_NOT_SUPPORTED.
 */
function rangedFileResponse(filename: string, request: Request): Response {
  let size: number
  try {
    size = statSync(filename).size
  } catch {
    return new Response("Not found", { status: 404 })
  }

  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Content-Type":
      CAPTURE_CONTENT_TYPES[extname(filename).toLowerCase()] ??
      "application/octet-stream",
    // The renderer runs on a different origin than this protocol. The trim
    // editor samples frames into a canvas, and reading those pixels back is
    // only allowed when the media was fetched via CORS.
    "Access-Control-Allow-Origin": "*",
    // fetch()-based readers (mediabunny) size the file off these headers.
    "Access-Control-Expose-Headers":
      "Content-Length, Content-Range, Accept-Ranges",
  }

  const range =
    parseByteRange(request.headers.get("range"), size) ??
    parseQueryByteRange(request.url, size)
  if (range) {
    headers["Content-Length"] = String(range.end - range.start + 1)
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`
  } else {
    headers["Content-Length"] = String(size)
  }

  const stream = createReadStream(
    filename,
    range ? { start: range.start, end: range.end } : undefined,
  )
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: range ? 206 : 200,
    headers,
  })
}

/**
 * Range requested as `?range=start-end` (inclusive), an alternative to the
 * Range header. The editor's mediabunny reader uses this because a custom
 * request header forces a CORS preflight on cross-origin fetches to this
 * scheme, while a plain GET sails through with the existing CORS headers.
 */
function parseQueryByteRange(
  rawUrl: string,
  size: number,
): { start: number; end: number } | null {
  if (size <= 0) return null
  let value: string | null
  try {
    value = new URL(rawUrl).searchParams.get("range")
  } catch {
    return null
  }
  if (!value) return null
  const match = /^(\d+)-(\d+)$/.exec(value)
  if (!match) return null
  const start = Number(match[1])
  const end = Math.min(Number(match[2]), size - 1)
  if (!Number.isFinite(start) || start >= size || end < start) return null
  return { start, end }
}

/** Parses a single-range `Range` header; anything else falls back to 200. */
function parseByteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header || size <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, startText, endText] = match

  if (!startText) {
    // Suffix range: the final N bytes.
    const suffix = Number(endText)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    const start = Math.max(0, size - suffix)
    return { start, end: size - 1 }
  }

  const start = Number(startText)
  if (!Number.isFinite(start) || start >= size) return null
  const end = endText ? Math.min(Number(endText), size - 1) : size - 1
  if (!Number.isFinite(end) || end < start) return null
  return { start, end }
}

export function rememberRecordingLibraryCapture(
  capture: RecordingCapture,
): void {
  const filename = resolve(capture.filename)
  const manifest = readCaptureManifest()
  const existing = manifest.captures[manifestKey(filename)]
  manifest.captures[manifestKey(filename)] = {
    ...existing,
    filename,
    title: titleForCapture(capture.kind, capture.createdAt),
    kind: capture.kind,
    source: capture.source,
    gameName: capture.game?.name ?? null,
    gameIconUrl: capture.game?.iconUrl ?? null,
    sizeBytes: capture.sizeBytes,
    durationMs: capture.durationMs,
    width: capture.width,
    height: capture.height,
    createdAt: capture.createdAt,
    updatedAt: new Date().toISOString(),
  }
  writeCaptureManifest(manifest)
  warmRecordingThumbnail(capture)
}

/**
 * Persists user-edited upload metadata (title, description, tags, mentions,
 * privacy) for a capture so drafts survive app restarts. Creates a manifest
 * entry on demand for captures that were scanned from disk rather than
 * recorded through the app.
 */
export function updateRecordingLibraryCaptureMeta(
  patch: RecordingLibraryMetaPatch,
): void {
  const item = findRecordingLibraryItem(patch.id)
  if (!item) throw new Error("Capture not found.")

  const manifest = readCaptureManifest()
  const key = manifestKey(item.filename)
  const entry: CaptureManifestEntry = manifest.captures[key] ?? {
    filename: item.filename,
    title: item.title,
    kind: item.kind,
    source: item.source,
    gameName: item.gameName,
    gameIconUrl: null,
    sizeBytes: item.sizeBytes,
    durationMs: item.durationMs,
    width: item.width,
    height: item.height,
    createdAt: item.createdAt,
    updatedAt: new Date().toISOString(),
  }

  if (patch.title !== undefined) entry.title = patch.title
  if (patch.description !== undefined) entry.description = patch.description
  if (patch.tags !== undefined) entry.tags = patch.tags
  if (patch.mentions !== undefined) entry.mentions = patch.mentions
  if (patch.privacy !== undefined) entry.privacy = patch.privacy
  entry.updatedAt = new Date().toISOString()

  manifest.captures[key] = entry
  writeCaptureManifest(manifest)
}

export function saveRecordingLibraryProjectDraft(
  request: RecordingLibraryProjectDraftSaveRequest,
): RecordingLibraryProjectDraftSaveResult {
  const manifest = readCaptureManifest()
  const id =
    request.id && manifest.projectDrafts[request.id]
      ? request.id
      : `draft-${randomUUID()}`
  const existing = manifest.projectDrafts[id]
  const now = new Date().toISOString()
  const title = request.title.trim() || "Untitled project"
  const project = request.project

  manifest.projectDrafts[id] = {
    id,
    title,
    project,
    thumbnailSourceId: draftThumbnailSourceId(project),
    durationMs: projectDurationMs(project),
    clipCount: project.clips.length,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  writeCaptureManifest(manifest)
  return { id }
}

export function deleteRecordingLibraryProjectDraft(id: string): void {
  const manifest = readCaptureManifest()
  if (!manifest.projectDrafts[id]) return
  delete manifest.projectDrafts[id]
  writeCaptureManifest(manifest)
}

/**
 * Writes a rendered video (from the editor) into the Clips collection and
 * registers it in the manifest, so the next library scan picks it up like
 * any recorded capture.
 */
export function importRecordingLibraryCapture(
  request: RecordingLibraryImportRequest,
): RecordingLibraryImportResult {
  const root = join(currentOutputFolder(), "Clips")
  mkdirSync(root, { recursive: true })

  const safeBase =
    request.fileName
      .replace(/\.mp4$/i, "")
      .replace(/[^A-Za-z0-9 ._-]/g, "_")
      .trim() || "render"
  let filename = join(root, `${safeBase}.mp4`)
  for (let counter = 2; existsSync(filename); counter++) {
    filename = join(root, `${safeBase}-${counter}.mp4`)
  }
  writeFileSync(filename, Buffer.from(request.data))

  const absolute = resolve(filename)
  const createdAt = new Date().toISOString()
  const manifest = readCaptureManifest()
  manifest.captures[manifestKey(absolute)] = {
    filename: absolute,
    title: `Render ${new Date(createdAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`,
    kind: "replay",
    source: "display",
    gameName: null,
    gameIconUrl: null,
    sizeBytes: request.data.byteLength,
    durationMs: request.durationMs > 0 ? Math.round(request.durationMs) : null,
    width: request.width,
    height: request.height,
    createdAt,
    updatedAt: createdAt,
  }
  writeCaptureManifest(manifest)

  return { id: captureId(absolute) }
}

/**
 * Moves a capture's file to the OS trash and forgets its manifest entry and
 * cached thumbnails/filmstrip frames. Trashing (not unlinking) keeps the
 * delete hotkey recoverable.
 */
export async function deleteRecordingLibraryItem(id: string): Promise<void> {
  const item = findRecordingLibraryItem(id)
  if (!item) throw new Error("Capture not found.")

  await shell.trashItem(item.filename)

  const manifest = readCaptureManifest()
  if (manifest.captures[manifestKey(item.filename)]) {
    delete manifest.captures[manifestKey(item.filename)]
    writeCaptureManifest(manifest)
  }
  // Passing an impossible "keep" name clears every cached file for the id.
  pruneStaleThumbnails(id, "")
  pruneStaleFilmstripFrames(id, "")
}

export function getRecordingLibrarySnapshot(): RecordingLibrarySnapshot {
  const outputFolder = currentOutputFolder()
  const screenshotFolder = defaultScreenshotFolder()
  const manifest = readCaptureManifest()
  const items = scanRecordingLibraryItems(
    outputFolder,
    screenshotFolder,
    manifest,
  ).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const groups = groupLibraryItems(items)
  return {
    outputFolder,
    screenshotFolder,
    scannedAt: new Date().toISOString(),
    totalCount: items.length,
    totalSizeBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
    items,
    groups,
    projectDrafts: Object.values(manifest.projectDrafts).sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    ),
  }
}

export function openRecordingLibraryFolder(): void {
  const folder = currentOutputFolder()
  const openError = shell.openPath(folder)
  void openError.then((message) => {
    if (message)
      logger.warn("[desktop] failed to open library folder:", message)
  })
}

export function openRecordingLibraryItem(id: string): void {
  const item = findRecordingLibraryItem(id)
  if (!item) return

  const openError = shell.openPath(item.filename)
  void openError.then((message) => {
    if (message)
      logger.warn("[desktop] failed to open library capture:", message)
  })
}

export function revealRecordingLibraryItem(id: string): void {
  const item = findRecordingLibraryItem(id)
  if (!item) return

  shell.showItemInFolder(item.filename)
}

/** Smallest segment and total an export may carry. */
const EXPORT_MIN_SEGMENT_MS = 100
const EXPORT_MIN_TOTAL_MS = 1000

export async function exportRecordingLibraryItem(
  request: RecordingLibraryExportRequest,
) {
  const item = findRecordingLibraryItem(request.id)
  if (!item) throw new Error("Capture not found.")
  if (item.kind === "screenshot") {
    throw new Error("Screenshots cannot be uploaded as clips yet.")
  }

  const sourceDurationMs = item.durationMs
  if (!sourceDurationMs || sourceDurationMs <= 0) {
    throw new Error("Could not determine capture duration.")
  }

  const segments = sanitizeExportSegments(request.segments, sourceDurationMs)
  const totalMs = segments.reduce(
    (sum, segment) => sum + (segment.endMs - segment.startMs),
    0,
  )
  if (segments.length === 0 || totalMs < EXPORT_MIN_TOTAL_MS) {
    throw new Error("The selection is too short to export.")
  }

  const fullSource =
    segments.length === 1 &&
    segments[0].startMs <= 50 &&
    segments[0].endMs >= sourceDurationMs - 50

  // The source capture's hash is a representative placeholder for edited
  // exports too; the server recomputes the canonical one while processing.
  const thumbBlurHash = await ensureCaptureBlurHash(item)

  if (fullSource) {
    return {
      id: item.id,
      mediaUrl: item.mediaUrl,
      fileName: item.fileName,
      contentType: contentTypeForFile(item.fileName),
      sizeBytes: item.sizeBytes,
      durationMs: sourceDurationMs,
      width: item.width,
      height: item.height,
      thumbBlurHash,
    }
  }

  const segmentsKey = segments
    .map((segment) => `${segment.startMs}-${segment.endMs}`)
    .join(",")
  const exportId = captureId(
    `${item.filename}:${statSync(item.filename).mtimeMs}:${segmentsKey}`,
  )
  const fileName = exportFileName(item.fileName, segments)
  const out = join(exportFolder(), `${exportId}.mp4`)
  mkdirSync(dirname(out), { recursive: true })

  if (!existsSync(out) || statSync(out).size === 0) {
    if (segments.length === 1) {
      await trimRecordingCapture(
        item.filename,
        out,
        segments[0].startMs,
        segments[0].endMs,
      )
    } else {
      await concatRecordingCaptureSegments(item.filename, out, segments)
    }
  }

  const stat = statSync(out)
  exportedCaptureFiles.set(exportId, out)

  return {
    id: exportId,
    mediaUrl: `${MEDIA_PROTOCOL}://${EXPORT_HOST}/${exportId}`,
    fileName,
    contentType: "video/mp4",
    sizeBytes: stat.size,
    durationMs: totalMs,
    width: item.width,
    height: item.height,
    thumbBlurHash,
  }
}

/**
 * Clamps every segment into the media bounds and drops degenerate ones.
 * Order is preserved — it's the playback order of the edited sequence.
 */
function sanitizeExportSegments(
  segments: RecordingLibraryExportSegment[],
  sourceDurationMs: number,
): RecordingLibraryExportSegment[] {
  return segments
    .map((segment) => {
      const startMs = clampMs(segment.startMs, 0, sourceDurationMs)
      return {
        startMs,
        endMs: clampMs(segment.endMs, startMs, sourceDurationMs),
      }
    })
    .filter(
      (segment) => segment.endMs - segment.startMs >= EXPORT_MIN_SEGMENT_MS,
    )
}

/* ─── Keyframe probing ─────────────────────────────────────────────── */

const KEYFRAME_CACHE_MAX = 32
const keyframeCache = new Map<string, Promise<number[]>>()

/**
 * Returns the capture's video keyframe (I-frame) positions in milliseconds,
 * sorted ascending, for the editor timeline. Results are cached per file
 * signature (id + mtime + size); failures return an empty list because the
 * markers are purely informational.
 */
export async function getRecordingLibraryCaptureKeyframes(
  id: string,
): Promise<number[]> {
  const item = findRecordingLibraryItem(id)
  if (!item || item.kind === "screenshot") return []

  let stat: Stats
  try {
    stat = statSync(item.filename)
  } catch {
    return []
  }

  const key = thumbnailSignature(item.id, stat)
  const pending = keyframeCache.get(key)
  if (pending) return pending

  const task = probeCaptureKeyframes(item.filename).catch((cause) => {
    keyframeCache.delete(key)
    logger.warn("[desktop] capture keyframe probe failed:", cause)
    return []
  })
  // Evict the oldest entry instead of growing across the whole library.
  if (keyframeCache.size >= KEYFRAME_CACHE_MAX) {
    const oldest = keyframeCache.keys().next().value
    if (oldest !== undefined) keyframeCache.delete(oldest)
  }
  keyframeCache.set(key, task)
  return task
}

/** Reads packet headers only (no decode), so long captures stay fast. */
async function probeCaptureKeyframes(filename: string): Promise<number[]> {
  const stdout = await runFfprobe(
    [
      "-select_streams",
      "v:0",
      "-show_entries",
      "packet=pts_time,flags",
      "-of",
      "csv=print_section=0",
      filename,
    ],
    { timeout: 60_000 },
  )

  const keyframes: number[] = []
  for (const line of stdout.split("\n")) {
    const [pts, flags] = line.trim().split(",")
    if (!flags?.includes("K")) continue
    const seconds = Number.parseFloat(pts)
    if (Number.isFinite(seconds)) keyframes.push(Math.round(seconds * 1000))
  }
  keyframes.sort((a, b) => a - b)
  return keyframes
}

function findRecordingLibraryItem(id: string): RecordingLibraryItem | null {
  for (const item of scanRecordingLibraryItems(
    currentOutputFolder(),
    defaultScreenshotFolder(),
    readCaptureManifest(),
  )) {
    if (item.id === id) return item
  }

  return null
}

function scanRecordingLibraryItems(
  outputFolder: string,
  screenshotFolder: string,
  manifest: CaptureManifest,
): RecordingLibraryItem[] {
  const collections: CollectionScan[] = [
    {
      root: join(outputFolder, "Clips"),
      collection: "Clips",
      kind: "replay",
    },
    {
      root: join(outputFolder, "Sessions"),
      collection: "Sessions",
      kind: "long-recording",
    },
    {
      root: join(screenshotFolder, "Screenshots"),
      collection: "Screenshots",
      kind: "screenshot",
    },
  ]

  return collections.flatMap((collection) =>
    scanCollection(collection, manifest),
  )
}

function scanCollection(
  collection: CollectionScan,
  manifest: CaptureManifest,
): RecordingLibraryItem[] {
  const root = resolve(collection.root)
  if (!existsSync(root)) return []

  const items: RecordingLibraryItem[] = []
  walkFiles(root, (filename) => {
    const item = libraryItemForFile(collection, root, filename, manifest)
    if (item) items.push(item)
  })
  return items
}

function walkFiles(root: string, visit: (filename: string) => void): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch (cause) {
    logger.warn("[desktop] failed to scan recording library:", cause)
    return
  }

  for (const entry of entries) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      walkFiles(entryPath, visit)
    } else if (entry.isFile()) {
      visit(entryPath)
    }
  }
}

function libraryItemForFile(
  collection: CollectionScan,
  collectionRoot: string,
  filename: string,
  manifest: CaptureManifest,
): RecordingLibraryItem | null {
  const extension = extname(filename).toLowerCase()
  if (!extensionMatchesKind(extension, collection.kind)) return null

  let stat: Stats
  try {
    stat = statSync(filename)
  } catch {
    return null
  }

  const absoluteFilename = resolve(filename)
  const id = captureId(absoluteFilename)
  const manifestEntry = manifest.captures[manifestKey(absoluteFilename)]
  const groupLabel = groupLabelForFile(collectionRoot, absoluteFilename)
  const createdAt =
    manifestEntry?.createdAt ?? statTimeIso(stat.birthtimeMs, stat.mtimeMs)
  const modifiedAt = new Date(stat.mtimeMs).toISOString()
  const source = manifestEntry?.source ?? sourceFromLabel(groupLabel)
  const kind = manifestEntry?.kind ?? collection.kind
  const mediaUrl = `${MEDIA_PROTOCOL}://${MEDIA_HOST}/${id}`
  // The version query busts the renderer's image cache when the capture file
  // itself changes; the protocol handler routes on pathname only.
  const thumbnailVersion = `${Math.round(stat.mtimeMs)}-${stat.size}`

  return {
    id,
    title: manifestEntry?.title ?? titleForCapture(kind, createdAt),
    filename: absoluteFilename,
    fileName: basename(absoluteFilename),
    mediaUrl,
    thumbnailUrl:
      kind === "screenshot"
        ? mediaUrl
        : `${MEDIA_PROTOCOL}://${THUMBNAIL_HOST}/${id}?v=${thumbnailVersion}`,
    filmstripFrameUrls:
      kind === "screenshot"
        ? []
        : Array.from(
            { length: FILMSTRIP_FRAME_COUNT },
            (_, frame) =>
              `${MEDIA_PROTOCOL}://${FILMSTRIP_HOST}/${id}/${frame}?v=${thumbnailVersion}`,
          ),
    thumbBlurHash: getThumbnailBlurHash(`${id}-${thumbnailVersion}`),
    collection: collection.collection,
    kind,
    source,
    groupKey: groupKeyForLabel(groupLabel),
    groupLabel,
    gameName:
      manifestEntry?.gameName ?? (source === "game" ? groupLabel : null),
    // The manifest keeps the raw remote URL; snapshots hand the renderer the
    // disk-cached variant so icons survive restarts and offline servers.
    gameIconUrl: cachedAssetUrl(manifestEntry?.gameIconUrl ?? null),
    sizeBytes: manifestEntry?.sizeBytes ?? stat.size,
    durationMs: manifestEntry?.durationMs ?? null,
    width: manifestEntry?.width ?? null,
    height: manifestEntry?.height ?? null,
    description: manifestEntry?.description ?? null,
    tags: manifestEntry?.tags ?? null,
    mentions: manifestEntry?.mentions ?? [],
    privacy: manifestEntry?.privacy ?? null,
    createdAt,
    modifiedAt,
  }
}

function sourceFromLabel(groupLabel: string): RecordingCaptureSource {
  return groupLabel === "Desktop" ? "display" : "game"
}

function extensionMatchesKind(
  extension: string,
  kind: RecordingCaptureKind,
): boolean {
  return kind === "screenshot"
    ? IMAGE_EXTENSIONS.has(extension)
    : VIDEO_EXTENSIONS.has(extension)
}

function groupLabelForFile(collectionRoot: string, filename: string): string {
  const parent = dirname(filename)
  const relativeParent = relative(collectionRoot, parent)
  const firstSegment = relativeParent
    .split(/[\\/]/)
    .find((segment) => segment.length > 0 && segment !== ".")

  return firstSegment || "Desktop"
}

function groupKeyForLabel(label: string): string {
  return label.trim().toLowerCase() || "desktop"
}

function statTimeIso(birthtimeMs: number, mtimeMs: number): string {
  const time =
    Number.isFinite(birthtimeMs) && birthtimeMs > 0 ? birthtimeMs : mtimeMs
  return new Date(time).toISOString()
}

function titleForCapture(
  kind: RecordingCaptureKind,
  createdAt: string,
): string {
  const date = new Date(createdAt)
  const time = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
  if (kind === "long-recording") return `Session ${time}`
  if (kind === "screenshot") return `Screenshot ${time}`
  return `Clip ${time}`
}

function groupLibraryItems(
  items: RecordingLibraryItem[],
): RecordingLibraryGroup[] {
  const groups = new Map<string, RecordingLibraryGroup>()

  for (const item of items) {
    let group = groups.get(item.groupKey)
    if (!group) {
      group = {
        key: item.groupKey,
        label: item.groupLabel,
        kind: item.groupLabel === "Desktop" ? "desktop" : "game",
        iconUrl: item.gameIconUrl,
        totalCount: 0,
        clipCount: 0,
        sessionCount: 0,
        screenshotCount: 0,
        totalSizeBytes: 0,
        latestAt: item.createdAt,
        items: [],
      }
      groups.set(item.groupKey, group)
    }

    group.totalCount += 1
    group.iconUrl ??= item.gameIconUrl
    group.totalSizeBytes += item.sizeBytes
    group.latestAt =
      Date.parse(item.createdAt) > Date.parse(group.latestAt)
        ? item.createdAt
        : group.latestAt
    if (item.kind === "replay") group.clipCount += 1
    if (item.kind === "long-recording") group.sessionCount += 1
    if (item.kind === "screenshot") group.screenshotCount += 1
    group.items.push(item)
  }

  return [...groups.values()].sort(
    (a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt),
  )
}

function captureId(filename: string): string {
  return createHash("sha256")
    .update(process.platform === "win32" ? filename.toLowerCase() : filename)
    .digest("base64url")
    .slice(0, 22)
}

const pendingThumbnails = new Map<string, Promise<string | null>>()

type ThumbnailSource = Pick<RecordingLibraryItem, "id" | "kind" | "filename">

async function ensureRecordingThumbnail(
  item: ThumbnailSource,
): Promise<string | null> {
  if (item.kind === "screenshot") return item.filename
  if (!VIDEO_EXTENSIONS.has(extname(item.filename).toLowerCase())) return null

  let stat: Stats
  try {
    stat = statSync(item.filename)
  } catch {
    return null
  }

  const out = thumbnailPath(item.id, stat)
  if (existsSync(out)) return out

  // Concurrent protocol requests for the same capture (grid + editor poster)
  // must share one ffmpeg run instead of racing on the output file.
  const pending = pendingThumbnails.get(out)
  if (pending) return pending

  const task = generateRecordingThumbnail(item, out).finally(() => {
    pendingThumbnails.delete(out)
  })
  pendingThumbnails.set(out, task)
  return task
}

async function generateRecordingThumbnail(
  item: ThumbnailSource,
  out: string,
): Promise<string | null> {
  try {
    mkdirSync(dirname(out), { recursive: true })
    pruneStaleThumbnails(item.id, out)

    // `thumbnail=n=…` scans a window of decoded frames and keeps the most
    // representative one, so fade-ins and black lead frames don't become the
    // poster. Seek past the first second when the clip is long enough.
    const attempts: string[][] = [
      ["-ss", "1", "-i", item.filename],
      ["-i", item.filename],
    ]
    for (const input of attempts) {
      try {
        await runFfmpeg(
          [
            "-y",
            ...input,
            "-frames:v",
            "1",
            "-vf",
            "thumbnail=n=24,scale=640:-2",
            "-q:v",
            "4",
            out,
          ],
          { timeout: 20_000 },
        )
      } catch (cause) {
        logger.warn("[desktop] recording thumbnail pass failed:", cause)
        continue
      }
      if (existsSync(out) && statSync(out).size > 0) return out
    }
    return null
  } catch (cause) {
    logger.warn("[desktop] failed to generate recording thumbnail:", cause)
    return null
  }
}

/* ─── Editor filmstrip ─────────────────────────────────────────────── */

const pendingFilmstripFrames = new Map<string, Promise<string | null>>()
/**
 * Filmstrip frames generate sequentially through this chain so a burst of
 * 16 protocol requests doesn't spawn 16 concurrent ffmpeg decodes.
 */
let filmstripQueue: Promise<unknown> = Promise.resolve()

/**
 * Renders one evenly spaced filmstrip frame for the editor timeline via a
 * fast input seek (no full decode, so hour-long sessions stay cheap).
 * Frames are cached on disk per file signature and regenerated when the
 * capture changes.
 */
async function ensureRecordingFilmstripFrame(
  item: RecordingLibraryItem,
  frameIndex: number,
): Promise<string | null> {
  if (item.kind === "screenshot") return null

  let stat: Stats
  try {
    stat = statSync(item.filename)
  } catch {
    return null
  }

  const out = join(
    filmstripFolder(),
    `${thumbnailSignature(item.id, stat)}-${frameIndex}.jpg`,
  )
  if (existsSync(out)) return out

  const pending = pendingFilmstripFrames.get(out)
  if (pending) return pending

  const task: Promise<string | null> = filmstripQueue
    .then(() => generateFilmstripFrame(item, frameIndex, out))
    .finally(() => {
      pendingFilmstripFrames.delete(out)
    })
  // generateFilmstripFrame never rejects, so the chain can't poison itself.
  filmstripQueue = task
  pendingFilmstripFrames.set(out, task)
  return task
}

async function generateFilmstripFrame(
  item: RecordingLibraryItem,
  frameIndex: number,
  out: string,
): Promise<string | null> {
  try {
    if (existsSync(out)) return out
    mkdirSync(dirname(out), { recursive: true })
    pruneStaleFilmstripFrames(item.id, basename(out))

    const durationMs = item.durationMs ?? (await probeDurationMs(item.filename))
    if (!durationMs || durationMs <= 0) return null

    const targetMs = Math.min(
      Math.max(0, durationMs - 100),
      ((frameIndex + 0.5) / FILMSTRIP_FRAME_COUNT) * durationMs,
    )
    await runFfmpeg(
      [
        "-y",
        "-ss",
        ffmpegSeconds(targetMs),
        "-i",
        item.filename,
        "-frames:v",
        "1",
        "-vf",
        "scale=-2:96",
        "-q:v",
        "5",
        out,
      ],
      { timeout: 20_000 },
    )
    return existsSync(out) && statSync(out).size > 0 ? out : null
  } catch (cause) {
    logger.warn("[desktop] filmstrip frame failed:", cause)
    return null
  }
}

async function probeDurationMs(filename: string): Promise<number | null> {
  try {
    const stdout = await runFfprobe(
      ["-show_entries", "format=duration", "-of", "csv=p=0", filename],
      { timeout: 30_000 },
    )
    const seconds = Number.parseFloat(stdout.trim())
    return Number.isFinite(seconds) && seconds > 0
      ? Math.round(seconds * 1000)
      : null
  } catch {
    return null
  }
}

/** Drops filmstrip frames generated from an older version of the capture. */
function pruneStaleFilmstripFrames(id: string, keepPrefixOf: string): void {
  const folder = filmstripFolder()
  const keepSignature = keepPrefixOf.replace(/-\d+\.jpg$/, "")
  let entries: Dirent[]
  try {
    entries = readdirSync(folder, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.startsWith(`${id}-`)) continue
    if (entry.name.startsWith(`${keepSignature}-`)) continue
    try {
      rmSync(join(folder, entry.name), { force: true })
    } catch {
      // Best effort — a locked stale file just lingers until the next pass.
    }
  }
}

function filmstripFolder(): string {
  return join(app.getPath("userData"), "recording-filmstrips")
}

/** Drops thumbnails generated from an older mtime/size of the same capture. */
function pruneStaleThumbnails(id: string, keep: string): void {
  const folder = thumbnailFolder()
  let entries: Dirent[]
  try {
    entries = readdirSync(folder, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.startsWith(`${id}-`)) continue
    const path = join(folder, entry.name)
    if (path === keep) continue
    try {
      rmSync(path, { force: true })
    } catch {
      // Best effort — a locked stale file just lingers until the next pass.
    }
  }
}

/**
 * Generates the thumbnail and BlurHash in the background as soon as a capture
 * lands, so the library grid shows real frames (or at least a blurred
 * placeholder) on first paint.
 */
function warmRecordingThumbnail(capture: RecordingCapture): void {
  const filename = resolve(capture.filename)
  void ensureCaptureBlurHash({
    id: captureId(filename),
    kind: capture.kind,
    filename,
  })
}

/**
 * Computes (and persists) the BlurHash for a capture from its thumbnail —
 * or from the image itself for screenshots. Hashes are keyed by the same
 * mtime/size signature as thumbnail files, so they stay stable across app
 * starts and invalidate together with the thumbnail when the file changes.
 */
async function ensureCaptureBlurHash(
  item: ThumbnailSource,
): Promise<string | null> {
  let stat: Stats
  try {
    stat = statSync(item.filename)
  } catch {
    return null
  }

  const signature = thumbnailSignature(item.id, stat)
  const existing = getThumbnailBlurHash(signature)
  if (existing) return existing

  const imagePath =
    item.kind === "screenshot"
      ? item.filename
      : await ensureRecordingThumbnail(item)
  if (!imagePath) return null

  const blurHash = imageFileBlurHash(imagePath)
  if (blurHash) {
    rememberThumbnailBlurHash(signature, blurHash)
    pruneThumbnailBlurHashes(item.id, signature)
  }
  return blurHash
}

function thumbnailSignature(id: string, stat: Stats): string {
  return `${id}-${Math.round(stat.mtimeMs)}-${stat.size}`
}

function thumbnailPath(id: string, stat: Stats): string {
  return join(thumbnailFolder(), `${thumbnailSignature(id, stat)}.jpg`)
}

function thumbnailFolder(): string {
  return join(app.getPath("userData"), "recording-thumbnails")
}

async function trimRecordingCapture(
  input: string,
  output: string,
  trimStartMs: number,
  trimEndMs: number,
): Promise<void> {
  const start = ffmpegSeconds(trimStartMs)
  const duration = ffmpegSeconds(trimEndMs - trimStartMs)

  try {
    await runFfmpeg(
      [
        "-y",
        "-ss",
        start,
        "-i",
        input,
        "-t",
        duration,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: 120_000 },
    )
  } catch (cause) {
    logger.warn("[desktop] stream-copy trim failed; retrying encode:", cause)
    await runFfmpeg(
      [
        "-y",
        "-ss",
        start,
        "-i",
        input,
        "-t",
        duration,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: 300_000 },
    )
  }
}

/**
 * Renders an edited sequence (cut + reordered segments) in one re-encode
 * pass via filter_complex trim/concat. Stream copy can't express
 * frame-accurate cuts or reordering, so multi-segment exports always
 * re-encode.
 */
async function concatRecordingCaptureSegments(
  input: string,
  output: string,
  segments: RecordingLibraryExportSegment[],
): Promise<void> {
  const hasAudio = await captureHasAudioStream(input)

  const filters: string[] = []
  const concatInputs: string[] = []
  segments.forEach((segment, index) => {
    const start = ffmpegSeconds(segment.startMs)
    const end = ffmpegSeconds(segment.endMs)
    filters.push(
      `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`,
    )
    if (hasAudio) {
      filters.push(
        `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`,
      )
    }
    concatInputs.push(hasAudio ? `[v${index}][a${index}]` : `[v${index}]`)
  })
  filters.push(
    `${concatInputs.join("")}concat=n=${segments.length}:v=1:a=${hasAudio ? 1 : 0}` +
      (hasAudio ? "[v][a]" : "[v]"),
  )

  await runFfmpeg(
    [
      "-y",
      "-i",
      input,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[v]",
      ...(hasAudio ? ["-map", "[a]"] : []),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      ...(hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
      "-movflags",
      "+faststart",
      output,
    ],
    { timeout: 600_000 },
  )
}

async function captureHasAudioStream(filename: string): Promise<boolean> {
  try {
    const stdout = await runFfprobe(
      [
        "-select_streams",
        "a",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        filename,
      ],
      { timeout: 30_000 },
    )
    return stdout.trim().length > 0
  } catch (cause) {
    logger.warn("[desktop] audio stream probe failed:", cause)
    return false
  }
}

function clampMs(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function ffmpegSeconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3)
}

function exportFolder(): string {
  return join(app.getPath("userData"), "recording-exports")
}

function exportFileName(
  fileName: string,
  segments: RecordingLibraryExportSegment[],
): string {
  const base = basename(fileName, extname(fileName)) || "clip"
  if (segments.length === 1) {
    const [segment] = segments
    return `${base}-${Math.round(segment.startMs / 1000)}-${Math.round(segment.endMs / 1000)}.mp4`
  }
  return `${base}-edited.mp4`
}

function contentTypeForFile(fileName: string): string {
  switch (extname(fileName).toLowerCase()) {
    case ".mp4":
      return "video/mp4"
    case ".mov":
      return "video/quicktime"
    case ".mkv":
      return "video/x-matroska"
    case ".webm":
      return "video/webm"
    default:
      return "application/octet-stream"
  }
}

function projectDurationMs(project: RecordingLibraryProject): number {
  return project.clips.reduce((max, clip) => {
    const durationMs = Math.max(0, clip.sourceEndMs - clip.sourceStartMs)
    return Math.max(max, clip.startMs + durationMs)
  }, 0)
}

function draftThumbnailSourceId(
  project: RecordingLibraryProject,
): string | null {
  return (
    [...project.clips].sort((a, b) => a.startMs - b.startMs)[0]?.sourceId ??
    null
  )
}

function readCaptureManifest(): CaptureManifest {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath(), "utf8"))
    if (!isCaptureManifest(parsed)) throw new Error("Invalid manifest.")
    const record = parsed as {
      captures: Record<string, CaptureManifestEntry>
      projectDrafts?: unknown
    }
    return {
      version: 1,
      captures: record.captures,
      projectDrafts: isProjectDraftsRecord(record.projectDrafts)
        ? record.projectDrafts
        : {},
    }
  } catch {
    return { version: 1, captures: {}, projectDrafts: {} }
  }
}

function writeCaptureManifest(manifest: CaptureManifest): void {
  try {
    const path = manifestPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  } catch (cause) {
    logger.warn("[desktop] failed to write recording library manifest:", cause)
  }
}

function manifestPath(): string {
  return join(app.getPath("userData"), "recording-library.json")
}

function isCaptureManifest(value: unknown): value is CaptureManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { captures?: unknown }).captures === "object" &&
    (value as { captures?: unknown }).captures !== null
  )
}

function isProjectDraftsRecord(
  value: unknown,
): value is Record<string, RecordingLibraryProjectDraft> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function manifestKey(filename: string): string {
  return process.platform === "win32" ? filename.toLowerCase() : filename
}

type CaptureRoute =
  | { kind: "media" | "thumbnail" | "export"; id: string }
  | { kind: "filmstrip"; id: string; frameIndex: number }

function captureRouteFromUrl(rawUrl: string): CaptureRoute | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== `${MEDIA_PROTOCOL}:`) return null

    if (url.hostname === FILMSTRIP_HOST) {
      // Filmstrip paths carry the frame index: /{id}/{frame}.
      const [id, frameText] = url.pathname.replace(/^\/+/, "").split("/")
      const frameIndex = Number.parseInt(frameText ?? "", 10)
      if (
        !/^[A-Za-z0-9_-]{12,64}$/.test(id ?? "") ||
        !Number.isInteger(frameIndex) ||
        frameIndex < 0 ||
        frameIndex >= FILMSTRIP_FRAME_COUNT
      ) {
        return null
      }
      return { kind: "filmstrip", id, frameIndex }
    }

    const kind =
      url.hostname === MEDIA_HOST
        ? "media"
        : url.hostname === THUMBNAIL_HOST
          ? "thumbnail"
          : url.hostname === EXPORT_HOST
            ? "export"
            : null
    if (!kind) return null
    const id = url.pathname.replace(/^\/+/, "")
    return /^[A-Za-z0-9_-]{12,64}$/.test(id) ? { kind, id } : null
  } catch {
    return null
  }
}
