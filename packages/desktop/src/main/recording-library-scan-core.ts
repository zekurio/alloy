import {
  existsSync,
  readdirSync,
  statSync,
  type Dirent,
  type Stats,
} from "node:fs"
import { basename, dirname, extname, join, relative, resolve } from "node:path"

import type {
  RecordingCaptureKind,
  RecordingCaptureSource,
  RecordingLibraryGroup,
  RecordingLibraryItem,
  RecordingLibrarySnapshot,
} from "@alloy/contracts"

import type {
  CaptureManifest,
  CaptureManifestEntry,
} from "./recording-library-manifest"
import {
  captureId,
  MEDIA_HOST,
  MEDIA_PROTOCOL,
  THUMBNAIL_HOST,
  isCaptureId,
  titleForCapture,
  VIDEO_EXTENSIONS,
} from "./recording-library-shared"

export interface RecordingLibraryScanInput {
  outputFolder: string
  manifest: CaptureManifest
  hiddenFileKeys: string[]
  thumbnailBlurHashes: Record<string, string>
}

export interface RecordingLibraryScanWorkerRequest {
  id: number
  input: RecordingLibraryScanInput
}

export type RecordingLibraryScanWorkerResponse =
  | {
      id: number
      ok: true
      snapshot: RecordingLibrarySnapshot
    }
  | {
      id: number
      ok: false
      error: string
    }

type LibraryCollection = RecordingLibraryItem["collection"]

const UNCATEGORIZED_GROUP_LABEL = "Uncategorized"
const NO_GAME_GROUP_LABELS = new Set(["desktop", "uncategorized"])

interface CollectionScan {
  root: string
  collection: LibraryCollection
  kind: RecordingCaptureKind
}

export function createRecordingLibrarySnapshot(
  input: RecordingLibraryScanInput,
): RecordingLibrarySnapshot {
  const items = scanRecordingLibraryItems(
    input,
    new Set(input.hiddenFileKeys),
  ).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const groups = groupLibraryItems(items)
  return {
    outputFolder: input.outputFolder,
    scannedAt: new Date().toISOString(),
    totalCount: items.length,
    totalSizeBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
    items,
    groups,
  }
}

export function findRecordingLibraryItemInScan(
  input: RecordingLibraryScanInput,
  id: string,
): RecordingLibraryItem | null {
  for (const item of scanRecordingLibraryItems(
    input,
    new Set(input.hiddenFileKeys),
  )) {
    if (item.id === id) return item
  }

  return null
}

function scanRecordingLibraryItems(
  input: RecordingLibraryScanInput,
  hiddenFileKeys: Set<string>,
): RecordingLibraryItem[] {
  const collections: CollectionScan[] = [
    {
      root: join(input.outputFolder, "Clips"),
      collection: "Clips",
      kind: "replay",
    },
  ]

  return collections.flatMap((collection) =>
    scanCollection(collection, input, hiddenFileKeys),
  )
}

function scanCollection(
  collection: CollectionScan,
  input: RecordingLibraryScanInput,
  hiddenFileKeys: Set<string>,
): RecordingLibraryItem[] {
  const root = resolve(collection.root)
  if (!existsSync(root)) return []

  const items: RecordingLibraryItem[] = []
  walkFiles(root, (filename) => {
    const item = libraryItemForFile(
      collection,
      root,
      filename,
      input,
      hiddenFileKeys,
    )
    if (item) items.push(item)
  })
  return items
}

function walkFiles(root: string, visit: (filename: string) => void): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const entryPath = join(root, entry.name)
    if (entry.isDirectory()) {
      walkFiles(entryPath, visit)
      continue
    }
    if (entry.isFile()) visit(entryPath)
  }
}

function libraryItemForFile(
  collection: CollectionScan,
  collectionRoot: string,
  filename: string,
  input: RecordingLibraryScanInput,
  hiddenFileKeys: Set<string>,
): RecordingLibraryItem | null {
  const extension = extname(filename).toLowerCase()
  if (!extensionMatchesKind(extension, collection.kind)) return null

  const absoluteFilename = resolve(filename)
  if (hiddenFileKeys.has(manifestKey(absoluteFilename))) return null

  let stat: Stats
  try {
    stat = statSync(filename)
  } catch {
    return null
  }

  const manifestEntry = input.manifest.captures[manifestKey(absoluteFilename)]
  const id = isCaptureId(manifestEntry?.id)
    ? manifestEntry.id
    : captureId(absoluteFilename)
  const groupLabel = groupLabelForFile(collectionRoot, absoluteFilename)
  const createdAt =
    manifestEntry?.createdAt ?? statTimeIso(stat.birthtimeMs, stat.mtimeMs)
  const modifiedAt = new Date(stat.mtimeMs).toISOString()
  const source = manifestEntry?.source ?? sourceFromLabel(groupLabel)
  const kind = manifestEntry?.kind ?? collection.kind
  const mediaUrl = `${MEDIA_PROTOCOL}://${MEDIA_HOST}/${id}`
  const thumbnailVersion = `${Math.round(stat.mtimeMs)}-${stat.size}`
  const trim = manifestTrim(manifestEntry, manifestEntry?.durationMs ?? null)

  return {
    id,
    title: manifestEntry?.title ?? titleForCapture(createdAt),
    filename: absoluteFilename,
    fileName: basename(absoluteFilename),
    mediaUrl,
    thumbnailUrl: `${MEDIA_PROTOCOL}://${THUMBNAIL_HOST}/${id}?v=${thumbnailVersion}`,
    thumbBlurHash:
      input.thumbnailBlurHashes[`${id}-${thumbnailVersion}`] ?? null,
    collection: collection.collection,
    kind,
    source,
    groupKey: groupKeyForLabel(groupLabel),
    groupLabel,
    gameName:
      manifestEntry?.gameName ?? (source === "game" ? groupLabel : null),
    gameIconUrl: manifestEntry?.gameIconUrl ?? null,
    gameGuess: manifestEntry?.gameGuess ?? null,
    sizeBytes: manifestEntry?.sizeBytes ?? stat.size,
    durationMs: manifestEntry?.durationMs ?? null,
    width: manifestEntry?.width ?? null,
    height: manifestEntry?.height ?? null,
    description: manifestEntry?.description ?? null,
    tags: manifestEntry?.tags ?? null,
    mentions: manifestEntry?.mentions ?? [],
    privacy: manifestEntry?.privacy ?? null,
    uploadedClipId: manifestEntry?.uploadedClipId ?? null,
    trimStartMs: trim ? trim.startMs : null,
    trimEndMs: trim ? trim.endMs : null,
    createdAt,
    modifiedAt,
  }
}

/**
 * A manifest trim range fitted into the capture's known duration. Invalid or
 * out-of-bounds ranges resolve to null so a stale trim can't outlive a
 * replaced or corrected file.
 */
function manifestTrim(
  entry: CaptureManifestEntry | undefined,
  durationMs: number | null,
): { startMs: number; endMs: number } | null {
  const startMs = entry?.trimStartMs
  const endMs = entry?.trimEndMs
  if (typeof startMs !== "number" || typeof endMs !== "number") return null
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  if (startMs < 0 || endMs <= startMs) return null
  if (durationMs !== null && startMs >= durationMs) return null
  return {
    startMs,
    endMs: durationMs !== null ? Math.min(endMs, durationMs) : endMs,
  }
}

function sourceFromLabel(groupLabel: string): RecordingCaptureSource {
  return isNoGameGroupLabel(groupLabel) ? "display" : "game"
}

function extensionMatchesKind(
  extension: string,
  kind: RecordingCaptureKind,
): boolean {
  return kind === "replay" && VIDEO_EXTENSIONS.has(extension)
}

function groupLabelForFile(collectionRoot: string, filename: string): string {
  const parent = dirname(filename)
  const relativeParent = relative(collectionRoot, parent)
  const firstSegment = relativeParent
    .split(/[\\/]/)
    .find((segment) => segment.length > 0 && segment !== ".")

  const groupLabel = firstSegment || UNCATEGORIZED_GROUP_LABEL
  return isNoGameGroupLabel(groupLabel) ? UNCATEGORIZED_GROUP_LABEL : groupLabel
}

function groupKeyForLabel(label: string): string {
  if (isNoGameGroupLabel(label)) return "uncategorized"
  return label.trim().toLowerCase() || "uncategorized"
}

function statTimeIso(birthtimeMs: number, mtimeMs: number): string {
  const time =
    Number.isFinite(birthtimeMs) && birthtimeMs > 0 ? birthtimeMs : mtimeMs
  return new Date(time).toISOString()
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
        kind: isNoGameGroupLabel(item.groupLabel) ? "desktop" : "game",
        iconUrl: item.gameIconUrl,
        totalCount: 0,
        clipCount: 0,
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
    group.items.push(item)
  }

  return [...groups.values()].sort(
    (a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt),
  )
}

function isNoGameGroupLabel(label: string): boolean {
  return NO_GAME_GROUP_LABELS.has(label.trim().toLowerCase())
}

function manifestKey(filename: string): string {
  return process.platform === "win32" ? filename.toLowerCase() : filename
}
