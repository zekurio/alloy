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
  clipMediaFailureId,
  chooseClipMediaAction,
  clipMediaRetryDelayMs,
  legacyRenditionOperationCounts,
} from "./clip-media-policy"
import { mediaConfigSignatures } from "./media-generation"
import { WakeableMediaPump } from "./wakeable-media-pump"

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

test("generation signatures distinguish output and execution-only changes", () => {
  const baseline = mediaConfigSignatures(config)
  const hardware = mediaConfigSignatures({
    ...config,
    hardwareAcceleration:
      config.hardwareAcceleration === "none" ? "nvenc" : "none",
  })
  assert.equal(hardware.outputSignature, baseline.outputSignature)
  assert.notEqual(hardware.executionSignature, baseline.executionSignature)

  const quality = mediaConfigSignatures({
    ...config,
    quality: config.quality + 1,
  })
  assert.notEqual(quality.outputSignature, baseline.outputSignature)
  assert.notEqual(quality.executionSignature, baseline.executionSignature)
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
  const failureId = clipMediaFailureId(clipId)
  assert.equal(failureId, `clip-media:${clipId}`)
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

test("legacy rendition operation projects direct media activity", () => {
  assert.deepEqual(
    legacyRenditionOperationCounts({
      pending: 4,
      running: 2,
      failed: 1,
      completed: 99,
    }),
    { pending: 4, running: 2, failed: 1, completed: 0 },
  )
})

test("a wake racing an active media pass schedules an immediate second pass", async () => {
  let calls = 0
  const entered = deferred<void>()
  const release = deferred<void>()
  const repumped = deferred<void>()
  const pump = new WakeableMediaPump({
    reconciliationIntervalMs: 60_000,
    errorRetryMs: 5000,
    async runPass() {
      calls += 1
      if (calls === 1) {
        entered.resolve()
        await release.promise
      } else {
        repumped.resolve()
      }
      return null
    },
    onError: () => assert.fail("media pump unexpectedly failed"),
  })

  pump.start()
  await entered.promise
  pump.wake()
  release.resolve()
  await repumped.promise
  assert.equal(calls, 2)
  await pump.stop()
})

test("the media pump wakes at a persisted retry deadline", async () => {
  let calls = 0
  const reachedDeadline = deferred<void>()
  const pump = new WakeableMediaPump({
    reconciliationIntervalMs: 60_000,
    errorRetryMs: 5000,
    async runPass() {
      calls += 1
      if (calls === 1) return new Date(Date.now() + 20)
      reachedDeadline.resolve()
      return null
    },
    onError: () => assert.fail("media pump unexpectedly failed"),
  })

  pump.start()
  await reachedDeadline.promise
  assert.equal(calls, 2)
  await pump.stop()
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}
