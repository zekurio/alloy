import assert from "node:assert/strict"
import test from "node:test"

import type { ClipRow, GameNameLookupResult, GameRow } from "@alloy/api"
import type {
  RecordingLibraryGroup,
  RecordingLibraryItem,
} from "@alloy/contracts"

import {
  buildLibraryGroups,
  enrichLibraryGroup,
  enrichLibraryItem,
} from "./library-data"

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
