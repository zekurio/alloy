import assert from "node:assert/strict"
import test from "node:test"

import {
  ADMIN_JOB_QUEUES,
  AdminFailedJobSchema,
  JOB_KINDS,
  JOB_QUEUES,
  TranscodingConfigSchema,
} from "@alloy/contracts"
import { encodeFingerprint } from "@alloy/server/media/encode-fingerprint"

import {
  clipIdFromMediaFailureId,
  chooseClipMediaAction,
  clipMediaRetryDelayMs,
} from "./clip-media-policy"
import { mediaConfigSignature } from "./media-generation"

const config = TranscodingConfigSchema.parse({})
const facts = {
  height: 1080,
  sourceFps: 60,
  trimStartMs: null,
  trimEndMs: null,
  audioTrackFingerprint: null,
}

test("media jobs and their empty queue are retired from the registry contract", () => {
  const kinds = new Set<string>(JOB_KINDS)
  const queues = new Set<string>(JOB_QUEUES)
  assert.equal(kinds.has("clip.encode"), false)
  assert.equal(kinds.has("clip.renditions-sweep"), false)
  assert.equal(queues.has("encode"), false)
  assert.deepEqual(ADMIN_JOB_QUEUES, ["encode", "io", "maintenance"])
})

test("generation signature tracks output and execution config", () => {
  const baseline = mediaConfigSignature(config)
  const hardware = mediaConfigSignature({
    ...config,
    hardwareAcceleration:
      config.hardwareAcceleration === "none" ? "nvenc" : "none",
  })
  assert.notEqual(hardware, baseline)

  const quality = mediaConfigSignature({
    ...config,
    quality: config.quality + 1,
  })
  assert.notEqual(quality, baseline)
})

test("matching media skips full work but repairs a missing thumbnail", () => {
  const fingerprint = encodeFingerprint(config, facts)
  const base = {
    force: false,
    status: "ready" as const,
    facts,
    encodeFingerprint: fingerprint,
    encodeFailedFingerprint: null,
    encodeFailedGeneration: null,
    hasSource: true,
    hasThumbnail: true,
    thumbnailFailed: false,
    config,
    retryFailuresGeneration: 0,
  }
  assert.equal(chooseClipMediaAction(base), "skip")
  assert.equal(
    chooseClipMediaAction({ ...base, hasThumbnail: false }),
    "thumbnail",
  )
})

test("known failures quarantine until a generation explicitly rearms them", () => {
  const failedFingerprint = encodeFingerprint(config, facts)
  const base = {
    force: false,
    status: "ready" as const,
    facts,
    encodeFingerprint: null,
    encodeFailedFingerprint: failedFingerprint,
    encodeFailedGeneration: 4,
    hasSource: true,
    hasThumbnail: true,
    thumbnailFailed: false,
    config,
  }
  assert.equal(
    chooseClipMediaAction({ ...base, retryFailuresGeneration: 4 }),
    "quarantine",
  )
  assert.equal(
    chooseClipMediaAction({ ...base, retryFailuresGeneration: 5 }),
    "full",
  )
  assert.equal(
    chooseClipMediaAction({
      ...base,
      force: true,
      retryFailuresGeneration: 4,
    }),
    "full",
  )
})

test("retry policy retains the existing linear media backoff", () => {
  assert.equal(clipMediaRetryDelayMs(1), 30_000)
  assert.equal(clipMediaRetryDelayMs(2), 60_000)
  assert.equal(clipMediaRetryDelayMs(3), 90_000)
})

test("contract-1 media failure ids are synthetic and unambiguous", () => {
  const clipId = "018fdb4c-7d55-7ad8-9c18-3b8948ce6b55"
  const failureId = `clip-media:${clipId}`
  assert.equal(clipIdFromMediaFailureId(failureId), clipId)
  assert.equal(clipIdFromMediaFailureId(clipId), null)
  assert.equal(clipIdFromMediaFailureId("clip-media:not-a-uuid"), null)
  assert.equal(
    AdminFailedJobSchema.safeParse({
      id: failureId,
      kind: "clip.encode",
      clipId,
      error: "encode failed",
      attempt: 3,
      finishedAt: new Date().toISOString(),
      retryable: true,
    }).success,
    true,
  )
})
