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
import { logger } from "@alloy/logging"

import type {
  RecordingLibraryGroup,
  RecordingLibraryItem,
  RecordingLibrarySnapshot,
} from "@/shared/ipc"

import { cachedAssetUrl } from "./asset-cache"
import {
  readCaptureManifest,
  manifestKey,
  type CaptureManifest,
} from "./recording-library-manifest"
import {
  captureId,
  IMAGE_EXTENSIONS,
  MEDIA_HOST,
  MEDIA_PROTOCOL,
  THUMBNAIL_HOST,
  titleForCapture,
  VIDEO_EXTENSIONS,
} from "./recording-library-shared"
import {
  currentOutputFolder,
  defaultScreenshotFolder,
} from "./recording-storage"
import { getThumbnailBlurHash } from "./recording-thumbnail-meta"

type LibraryCollection = RecordingLibraryItem["collection"]

interface CollectionScan {
  root: string
  collection: LibraryCollection
  kind: RecordingCaptureKind
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

export function findRecordingLibraryItem(
  id: string,
): RecordingLibraryItem | null {
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
    bookmarksMs: manifestEntry?.bookmarksMs ?? [],
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
