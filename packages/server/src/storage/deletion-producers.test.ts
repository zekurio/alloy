import assert from "node:assert/strict"
import test from "node:test"

import { stagedSourceKey } from "../uploads/staged"
import {
  clipStorageDeletionIntents,
  mediaAssetDeletionIntents,
  posterDeletionIntents,
  stagedUploadDeletionIntent,
} from "./deletion-producers"

const clipId = "11ebc58a-92f9-4f9d-b88c-3e89150b7d1e"

test("staged source keys are canonical and unique per upload attempt", () => {
  const first = stagedSourceKey(
    clipId.toUpperCase(),
    "video/mp4",
    "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
  )
  const second = stagedSourceKey(
    clipId,
    "video/mp4",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  )

  assert.equal(
    first,
    `uploads/${clipId}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/source.mp4`,
  )
  assert.notEqual(first, second)
})

test("clip deletion classifies committed and legacy objects by namespace", () => {
  const intents = clipStorageDeletionIntents({
    clipId,
    sourceKey: `11/eb/${clipId}/source-aabbccddeeff`,
    cutKey: `11/eb/${clipId}/cut-aabbccddeeff.mp4`,
    thumbKey: `11/eb/${clipId}/thumb-aabbccddeeff.jpg`,
    renditionKeys: [`11/eb/${clipId}/rendition-1080p-aabbccddeeff.mp4`],
    audioTrackKeys: [`11/eb/${clipId}/audio-1-aabbccddeeff.m4a`],
  })

  assert.deepEqual(
    intents.map(({ namespace, key, abortUpload }) => ({
      namespace,
      key,
      abortUpload: abortUpload ?? false,
    })),
    [
      {
        namespace: "clips",
        key: `11/eb/${clipId}/source-aabbccddeeff`,
        abortUpload: false,
      },
      {
        namespace: "clips",
        key: `11/eb/${clipId}/cut-aabbccddeeff.mp4`,
        abortUpload: false,
      },
      {
        namespace: "clips",
        key: `11/eb/${clipId}/rendition-1080p-aabbccddeeff.mp4`,
        abortUpload: false,
      },
      {
        namespace: "clips",
        key: `11/eb/${clipId}/audio-1-aabbccddeeff.m4a`,
        abortUpload: false,
      },
      {
        namespace: "thumbnails",
        key: `11/eb/${clipId}/thumb-aabbccddeeff.jpg`,
        abortUpload: false,
      },
      {
        namespace: "thumbnails",
        key: `11/eb/${clipId}/thumb.jpg`,
        abortUpload: false,
      },
      {
        namespace: "thumbnails",
        key: `11/eb/${clipId}/thumb-small.jpg`,
        abortUpload: false,
      },
    ],
  )
})

test("staged upload deletion always aborts resumable state", () => {
  assert.deepEqual(
    stagedUploadDeletionIntent({
      key: `uploads/${clipId}/attempt/source.mp4`,
      reason: "upload cancelled",
      source: { type: "upload-ticket", id: "ticket-id" },
    }),
    {
      namespace: "clips",
      key: `uploads/${clipId}/attempt/source.mp4`,
      abortUpload: true,
      reason: "upload cancelled",
      source: { type: "upload-ticket", id: "ticket-id" },
    },
  )
})

test("media replacement classifies namespaces and excludes every retained key", () => {
  const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const intents = mediaAssetDeletionIntents({
    keys: [
      `11/eb/${clipId}/source-old`,
      `11/eb/${clipId}/cut-old.mp4`,
      `11/eb/${clipId}/thumb-old.jpg`,
      `11/eb/${clipId}/rendition-1080p-old.mp4`,
      `11/eb/${clipId}/audio-1-old.m4a`,
    ],
    retainedKeys: [
      `11/EB/${clipId}/SOURCE-OLD`,
      `11/eb/${clipId}/audio-1-old.m4a`,
    ],
    reason: "media output replaced",
    source: { type: "media-run", id: runId },
  })

  assert.deepEqual(
    intents.map(({ namespace, key, source }) => ({ namespace, key, source })),
    [
      {
        namespace: "clips",
        key: `11/eb/${clipId}/cut-old.mp4`,
        source: { type: "media-run", id: runId },
      },
      {
        namespace: "thumbnails",
        key: `11/eb/${clipId}/thumb-old.jpg`,
        source: { type: "media-run", id: runId },
      },
      {
        namespace: "clips",
        key: `11/eb/${clipId}/rendition-1080p-old.mp4`,
        source: { type: "media-run", id: runId },
      },
    ],
  )
})

test("serialized poster swaps retire the fresh predecessor and rejected loser", () => {
  const oldKey = `11/eb/${clipId}/thumb-old.jpg`
  const firstKey = `11/eb/${clipId}/thumb-first.jpg`
  const secondKey = `11/eb/${clipId}/thumb-second.jpg`

  assert.deepEqual(
    posterDeletionIntents({
      previousKey: oldKey,
      uploadedKey: firstKey,
      accepted: true,
      attemptId: "first",
    }).map(({ namespace, key }) => ({ namespace, key })),
    [{ namespace: "thumbnails", key: oldKey }],
  )
  assert.deepEqual(
    posterDeletionIntents({
      previousKey: firstKey,
      uploadedKey: secondKey,
      accepted: true,
      attemptId: "second",
    }).map(({ namespace, key }) => ({ namespace, key })),
    [{ namespace: "thumbnails", key: firstKey }],
  )
  assert.deepEqual(
    posterDeletionIntents({
      previousKey: firstKey,
      uploadedKey: secondKey,
      accepted: false,
      attemptId: "loser",
    }).map(({ namespace, key }) => ({ namespace, key })),
    [{ namespace: "thumbnails", key: secondKey }],
  )
})
