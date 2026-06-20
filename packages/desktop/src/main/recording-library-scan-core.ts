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
} from "@alloy/contracts"

import type {
  RecordingLibraryGroup,
  RecordingLibraryItem,
  RecordingLibrarySnapshot,
} from "@/shared/ipc"

import type { CaptureManifest } from "./recording-library-manifest"
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
    } else if (entry.isFile()) {
      visit(entryPath)
    }
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
  return kind === "replay" && VIDEO_EXTENSIONS.has(extension)
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

function manifestKey(filename: string): string {
  return process.platform === "win32" ? filename.toLowerCase() : filename
}
