import assert from "node:assert/strict"

import { TranscodingConfigSchema } from "@alloy/contracts"
import { encodeFingerprint } from "@alloy/server/media/encode-fingerprint"
import { test } from "vite-plus/test"

import {
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
}

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

test("matching media repairs only the missing asset", () => {
  const fingerprint = encodeFingerprint(config, facts)
  assert.equal(Object.hasOwn(JSON.parse(fingerprint), "p"), false)
  const base = {
    force: false,
    status: "ready" as const,
    facts,
    encodeFingerprint: fingerprint,
    encodeFailedFingerprint: null,
    encodeFailedGeneration: null,
    hasSource: true,
    hasAudio: true,
    hasWaveform: true,
    hasCut: false,
    hasThumbnail: true,
    thumbnailFailed: false,
    config,
    retryFailuresGeneration: 0,
  }
  assert.equal(chooseClipMediaAction(base), "skip")
  assert.equal(
    chooseClipMediaAction({ ...base, hasWaveform: false }),
    "waveform",
  )
  assert.equal(chooseClipMediaAction({ ...base, hasAudio: false }), "waveform")
  assert.equal(
    chooseClipMediaAction({
      ...base,
      hasAudio: false,
      hasWaveform: false,
    }),
    "skip",
  )
  assert.equal(
    chooseClipMediaAction({ ...base, hasThumbnail: false }),
    "thumbnail",
  )

  const trimmedFacts = { ...facts, trimStartMs: 1_000, trimEndMs: 2_000 }
  assert.equal(
    chooseClipMediaAction({
      ...base,
      facts: trimmedFacts,
      encodeFingerprint: encodeFingerprint(config, trimmedFacts),
    }),
    "full",
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
    hasAudio: true,
    hasWaveform: true,
    hasCut: false,
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
