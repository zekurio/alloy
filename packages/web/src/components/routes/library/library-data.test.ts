import assert from "node:assert/strict"

import type { ClipRow, GameNameLookupResult, GameRow } from "@alloy/api"
import type {
  RecordingLibraryGroup,
  RecordingLibraryItem,
  RecordingLibrarySnapshot,
} from "@alloy/contracts"
import { test } from "vite-plus/test"

import {
  buildLibraryGroups,
  enrichLibraryGroup,
  enrichLibraryItem,
} from "./library-data"
import { buildLibraryEntries, collapsedServerCounts } from "./library-entries"

const valorant: GameRow = {
  id: "6bd20429-2b5d-4e4f-9a69-2909e07fd78d",
  steamgriddbId: 5258,
  source: "steamgriddb",
  name: "Valorant",
  slug: "valorant",
  releaseDate: null,
  heroUrl: null,
  heroBlurHash: null,
  gridUrl: null,
  gridBlurHash: null,
  logoUrl: null,
  iconUrl: null,
}

const valorantLookup = new Map<string, GameNameLookupResult>([
  [
    "valorant",
    {
      name: "VALORANT",
      game: valorant,
      confidence: 1,
      reason: "indexed-exact-name",
    },
  ],
])

test("uses the canonical game identity for a local detector label", () => {
  const view = enrichLibraryItem(localValorantCapture(), valorantLookup)

  assert.equal(view.displayGame, valorant)
  assert.equal(view.displayGameName, "Valorant")
  assert.equal(view.gameSlug, "valorant")
})

test("canonicalizes a local game group before merging uploaded clips", () => {
  const local = enrichLibraryGroup(localValorantGroup(), valorantLookup)
  const groups = buildLibraryGroups(
    [local],
    [
      // SAFETY: buildLibraryGroups reads only game and gameRef from clip rows.
      {
        id: "clip-1",
        game: "Valorant",
        gameRef: valorant,
      } as ClipRow,
    ],
  )

  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.label, "Valorant")
  assert.equal(groups[0]?.totalCount, 2)
  assert.deepEqual(groups[0]?.localKeys, ["valorant"])
})

test("source filters include synced clips wherever a copy exists", () => {
  const synced = { ...localValorantCapture(), uploadedClipId: "clip-1" }
  const local = { ...localValorantCapture(), id: "local-2" }
  // SAFETY: library entries read only these clip fields for filtering and sorting.
  const uploaded = ["clip-1", "clip-2"].map(
    (id) =>
      ({
        id,
        title: "Synced title",
        mediaKind: "video",
        game: "Valorant",
        gameRef: valorant,
        createdAt: synced.createdAt,
      }) as ClipRow,
  )
  const snapshot: RecordingLibrarySnapshot = {
    outputFolder: "C:\\Videos\\Alloy",
    scannedAt: synced.createdAt,
    totalCount: 2,
    totalSizeBytes: 2,
    items: [synced, local],
    groups: [
      { ...localValorantGroup(), totalCount: 2, items: [synced, local] },
    ],
  }
  const options = {
    snapshot,
    gamesByName: valorantLookup,
    uploaded,
    active: null,
    media: "all" as const,
    query: "",
  }
  const keys = (source: "all" | "local" | "server") =>
    buildLibraryEntries({ ...options, source }).map((entry) => entry.key)

  assert.deepEqual(keys("all"), [
    "local:local-2",
    "cloud:clip-1",
    "cloud:clip-2",
  ])
  assert.deepEqual(keys("server"), ["cloud:clip-1", "cloud:clip-2"])
  assert.deepEqual(keys("local"), ["local:local-2", "cloud:clip-1"])

  const mixed = {
    ...options,
    source: "all" as const,
    snapshot: {
      ...snapshot,
      items: [
        ...snapshot.items,
        { ...local, id: "image-local", kind: "screenshot" as const },
      ],
    },
    uploaded: [
      ...uploaded,
      { ...uploaded[0]!, id: "image-cloud", mediaKind: "image" as const },
    ],
  }
  const imageEntries = buildLibraryEntries({ ...mixed, media: "image" })
  assert.deepEqual(
    new Set(imageEntries.map((entry) => entry.key)),
    new Set(["local:image-local", "cloud:image-cloud"]),
  )
  assert.deepEqual(
    buildLibraryEntries({ ...mixed, media: "video" }).map((entry) => entry.key),
    keys("all"),
  )

  const [active] = buildLibraryGroups(
    snapshot.groups,
    uploaded,
    collapsedServerCounts(
      snapshot.items,
      new Set(uploaded.map((row) => row.id)),
    ),
  )
  const filtered = buildLibraryEntries({
    ...options,
    source: "local",
    active: active!,
    query: "Synced title",
  })
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0]?.status, "synced")
  assert.equal(filtered[0]?.type === "cloud" && filtered[0].localItem, synced)

  snapshot.items = [local]
  assert.deepEqual(keys("local"), ["local:local-2"])
})

function localValorantCapture(): RecordingLibraryItem {
  return {
    id: "local-1",
    title: "Clip 18. Aug., 21:30",
    filename: "C:\\Videos\\Alloy\\Clips\\VALORANT\\clip.mp4",
    fileName: "clip.mp4",
    mediaUrl: "alloy-recording://media/local-1",
    thumbnailUrl: null,
    thumbBlurHash: null,
    collection: "Clips",
    kind: "replay",
    source: "game",
    groupKey: "valorant",
    groupLabel: "VALORANT",
    gameName: "VALORANT",
    gameIconUrl: null,
    gameGuess: null,
    sizeBytes: 1,
    durationMs: 1,
    width: 1920,
    height: 1080,
    description: null,
    tags: null,
    mentions: [],
    privacy: null,
    uploadedClipId: null,
    trimStartMs: null,
    trimEndMs: null,
    createdAt: "2026-08-18T19:30:00.000Z",
    modifiedAt: "2026-08-18T19:30:00.000Z",
  }
}

function localValorantGroup(): RecordingLibraryGroup {
  const item = localValorantCapture()
  return {
    key: "valorant",
    label: "VALORANT",
    kind: "game",
    iconUrl: null,
    totalCount: 1,
    clipCount: 1,
    totalSizeBytes: 1,
    latestAt: item.createdAt,
    items: [item],
  }
}
