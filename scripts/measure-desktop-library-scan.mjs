#!/usr/bin/env node

import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, extname, join, relative, resolve } from "node:path"
import { performance } from "node:perf_hooks"

const DEFAULT_SIZES = [100, 1000, 5000]
const DEFAULT_RUNS = 12
const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".mov", ".webm"])
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"])

const options = parseArgs(process.argv.slice(2))
const sizes = options.sizes ?? DEFAULT_SIZES
const runs = options.runs ?? DEFAULT_RUNS
const root =
  options.root ?? join(tmpdir(), "alloy-plan-010-desktop-library-scan")

if (options.clean) {
  rmSync(root, { recursive: true, force: true })
}
mkdirSync(root, { recursive: true })

writeLine(
  JSON.stringify(
    {
      root,
      sizes,
      runs,
      note: "Cold is the first scan after fixture creation in this process; this script does not flush the OS file cache.",
    },
    null,
    2,
  ),
)

for (const size of sizes) {
  const cold = []
  for (let i = 0; i < runs; i += 1) {
    cold.push(measureScan(buildFixture(size)))
  }

  const fixture = buildFixture(size)
  const warm = []
  for (let i = 0; i < runs; i += 1) {
    warm.push(measureScan(fixture))
  }
  writeLine(
    JSON.stringify({
      size,
      filesVisited: cold[0]?.filesVisited ?? 0,
      items: cold[0]?.items ?? 0,
      coldP50Ms: percentile(cold, 0.5),
      coldP95Ms: percentile(cold, 0.95),
      coldRunsMs: cold.map((run) => round(run.ms)),
      warmP50Ms: percentile(warm, 0.5),
      warmP95Ms: percentile(warm, 0.95),
      warmRunsMs: warm.map((run) => round(run.ms)),
    }),
  )
}

function writeLine(line) {
  process.stdout.write(`${line}\n`)
}

function parseArgs(args) {
  const parsed = { clean: true }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === "--no-clean") {
      parsed.clean = false
    } else if (arg === "--root") {
      parsed.root = args[++i]
    } else if (arg === "--runs") {
      parsed.runs = Number(args[++i])
    } else if (arg === "--sizes") {
      parsed.sizes = args[++i]
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return parsed
}

function buildFixture(size) {
  const fixtureRoot = join(root, String(size))
  rmSync(fixtureRoot, { recursive: true, force: true })

  const outputFolder = join(fixtureRoot, "Videos", "Alloy")
  const screenshotFolder = join(fixtureRoot, "Pictures", "Alloy")
  const userData = join(fixtureRoot, "UserData")
  const manifest = { version: 1, captures: {}, projectDrafts: {} }

  const clipCount = Math.floor(size * 0.8)
  const sessionCount = Math.floor(size * 0.1)
  const screenshotCount = size - clipCount - sessionCount

  addCaptures({
    root: join(outputFolder, "Clips"),
    count: clipCount,
    extension: ".mp4",
    manifest,
    kind: "replay",
    sizeBytes: 1024,
  })
  addCaptures({
    root: join(outputFolder, "Sessions"),
    count: sessionCount,
    extension: ".mkv",
    manifest,
    kind: "long-recording",
    sizeBytes: 1024,
  })
  addCaptures({
    root: join(screenshotFolder, "Screenshots"),
    count: screenshotCount,
    extension: ".png",
    manifest,
    kind: "screenshot",
    sizeBytes: 256,
  })

  mkdirSync(userData, { recursive: true })
  writeFileSync(
    join(userData, "recording-library.json"),
    `${JSON.stringify(manifest)}\n`,
  )
  mkdirSync(join(userData, "recording-thumbnails"), { recursive: true })
  writeFileSync(
    join(userData, "recording-thumbnails", "meta.json"),
    JSON.stringify({ version: 1, blurHashes: {} }),
  )

  return { outputFolder, screenshotFolder, userData }
}

function addCaptures({
  root: collectionRoot,
  count,
  extension,
  manifest,
  kind,
  sizeBytes,
}) {
  const createdAt = new Date("2026-01-01T00:00:00.000Z")
  for (let i = 0; i < count; i += 1) {
    const group = `Game ${String(i % 20).padStart(2, "0")}`
    const folder = join(collectionRoot, group)
    mkdirSync(folder, { recursive: true })
    const filename = resolve(
      join(folder, `${kind}-${String(i).padStart(5, "0")}${extension}`),
    )
    writeFileSync(filename, Buffer.alloc(sizeBytes))
    const timestamp = new Date(createdAt.getTime() + i * 1000).toISOString()
    manifest.captures[manifestKey(filename)] = {
      filename,
      title: `${kind} ${i}`,
      kind,
      source: "game",
      gameName: group,
      gameIconUrl: null,
      sizeBytes,
      durationMs: kind === "screenshot" ? null : 30_000,
      bookmarksMs: [],
      width: kind === "screenshot" ? 1920 : 1280,
      height: kind === "screenshot" ? 1080 : 720,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }
}

function measureScan(fixture) {
  const started = performance.now()
  const manifest = readJson(join(fixture.userData, "recording-library.json"))
  const thumbnailMeta = readJson(
    join(fixture.userData, "recording-thumbnails", "meta.json"),
  )
  const state = { filesVisited: 0 }
  const items = scanRecordingLibraryItems(
    fixture.outputFolder,
    fixture.screenshotFolder,
    manifest,
    thumbnailMeta,
    state,
  ).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  groupLibraryItems(items)
  return {
    ms: performance.now() - started,
    filesVisited: state.filesVisited,
    items: items.length,
  }
}

function readJson(filename) {
  statSync(filename)
  return JSON.parse(readFileSync(filename, "utf8"))
}

function scanRecordingLibraryItems(
  outputFolder,
  screenshotFolder,
  manifest,
  thumbnailMeta,
  state,
) {
  const collections = [
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
    scanCollection(collection, manifest, thumbnailMeta, state),
  )
}

function scanCollection(collection, manifest, thumbnailMeta, state) {
  const collectionRoot = resolve(collection.root)
  if (!existsSync(collectionRoot)) return []

  const items = []
  walkFiles(collectionRoot, (filename) => {
    state.filesVisited += 1
    const item = libraryItemForFile(
      collection,
      collectionRoot,
      filename,
      manifest,
      thumbnailMeta,
    )
    if (item) items.push(item)
  })
  return items
}

function walkFiles(scanRoot, visit) {
  let entries
  try {
    entries = readdirSync(scanRoot, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const entryPath = join(scanRoot, entry.name)
    if (entry.isDirectory()) {
      walkFiles(entryPath, visit)
    } else if (entry.isFile()) {
      visit(entryPath)
    }
  }
}

function libraryItemForFile(
  collection,
  collectionRoot,
  filename,
  manifest,
  thumbnailMeta,
) {
  const extension = extname(filename).toLowerCase()
  if (!extensionMatchesKind(extension, collection.kind)) return null

  let stat
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
  const thumbnailVersion = `${Math.round(stat.mtimeMs)}-${stat.size}`

  return {
    id,
    title: manifestEntry?.title ?? `${kind} ${createdAt}`,
    filename: absoluteFilename,
    fileName: basename(absoluteFilename),
    mediaUrl: `alloy-capture://media/${id}`,
    thumbnailUrl:
      kind === "screenshot"
        ? `alloy-capture://media/${id}`
        : `alloy-capture://thumbnail/${id}?v=${thumbnailVersion}`,
    thumbBlurHash:
      thumbnailMeta.blurHashes[`${id}-${thumbnailVersion}`] ?? null,
    collection: collection.collection,
    kind,
    source,
    groupKey: groupKeyForLabel(groupLabel),
    groupLabel,
    gameName:
      manifestEntry?.gameName ?? (source === "game" ? groupLabel : null),
    gameIconUrl: manifestEntry?.gameIconUrl ?? null,
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

function sourceFromLabel(groupLabel) {
  return groupLabel === "Desktop" ? "display" : "game"
}

function extensionMatchesKind(extension, kind) {
  return kind === "screenshot"
    ? IMAGE_EXTENSIONS.has(extension)
    : VIDEO_EXTENSIONS.has(extension)
}

function groupLabelForFile(collectionRoot, filename) {
  const parent = dirname(filename)
  const relativeParent = relative(collectionRoot, parent)
  const firstSegment = relativeParent
    .split(/[\\/]/)
    .find((segment) => segment.length > 0 && segment !== ".")

  return firstSegment || "Desktop"
}

function groupKeyForLabel(label) {
  return label.trim().toLowerCase() || "desktop"
}

function statTimeIso(birthtimeMs, mtimeMs) {
  const time =
    Number.isFinite(birthtimeMs) && birthtimeMs > 0 ? birthtimeMs : mtimeMs
  return new Date(time).toISOString()
}

function groupLibraryItems(items) {
  const groups = new Map()

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

function captureId(filename) {
  return createHash("sha256")
    .update(process.platform === "win32" ? filename.toLowerCase() : filename)
    .digest("base64url")
    .slice(0, 22)
}

function manifestKey(filename) {
  return process.platform === "win32" ? filename.toLowerCase() : filename
}

function percentile(runs, percentileValue) {
  const sorted = runs.map((run) => run.ms).sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * percentileValue) - 1,
  )
  return round(sorted[index] ?? 0)
}

function round(value) {
  return Math.round(value * 10) / 10
}
