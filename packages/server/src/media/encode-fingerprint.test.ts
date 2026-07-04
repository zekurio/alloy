import assert from "node:assert/strict"
import { test } from "node:test"

import {
  TranscodingConfigSchema,
  type TranscodingConfig,
} from "@alloy/contracts"

import {
  browserSafeSource,
  encodeFingerprint,
  expectedLadder,
  type FingerprintSourceFacts,
} from "./encode-fingerprint"

const CONFIG = TranscodingConfigSchema.parse({})
const FACTS: FingerprintSourceFacts = {
  height: 1080,
  sourceFps: 60,
  sourceContentType: "video/mp4",
  sourceCodecs: "avc1.64002A,mp4a.40.2",
  trimStartMs: null,
  trimEndMs: null,
}

test("hardware settings do not change the encode fingerprint", () => {
  assert.equal(
    encodeFingerprint(
      config({
        hardwareAcceleration: "none",
        vaapiDevice: "/dev/dri/renderD128",
      }),
      FACTS,
    ),
    encodeFingerprint(
      config({
        hardwareAcceleration: "vaapi",
        vaapiDevice: "/dev/dri/renderD129",
      }),
      FACTS,
    ),
  )
})

test("desired output settings and trim values change the fingerprint", () => {
  const base = encodeFingerprint(CONFIG, FACTS)

  assert.notEqual(base, encodeFingerprint(config({ quality: 24 }), FACTS))
  assert.notEqual(
    base,
    encodeFingerprint(config({ audioBitrateKbps: 160 }), FACTS),
  )
  assert.notEqual(
    base,
    encodeFingerprint(
      config({
        tiers: [
          { height: 1080, maxFps: 60, maxrateKbps: 8000, og: true },
          { height: 720, maxFps: 60, maxrateKbps: 6000 },
          { height: 480, maxFps: 30, maxrateKbps: 2500 },
        ],
      }),
      FACTS,
    ),
  )
  assert.notEqual(
    base,
    encodeFingerprint(CONFIG, {
      ...FACTS,
      trimStartMs: 1500,
      trimEndMs: 32000,
    }),
  )
})

test("tiers above a browser-safe source do not affect that clip", () => {
  assert.equal(
    encodeFingerprint(CONFIG, FACTS),
    encodeFingerprint(
      config({
        tiers: [
          { height: 2160, maxFps: 60, maxrateKbps: 16000 },
          ...CONFIG.tiers,
        ],
      }),
      FACTS,
    ),
  )
})

test("trimmed H.264 matroska uses mp4 cut browser-safe semantics", () => {
  const trimmedMatroska = {
    ...FACTS,
    sourceContentType: "video/x-matroska",
    trimStartMs: 1500,
    trimEndMs: 32000,
  }
  const trimmedMp4 = {
    ...trimmedMatroska,
    sourceContentType: "video/mp4",
  }

  assert.equal(browserSafeSource(trimmedMatroska, { trimmed: true }), true)
  assert.deepEqual(
    expectedLadder(CONFIG, trimmedMatroska).map((step) => step.name),
    expectedLadder(CONFIG, trimmedMp4).map((step) => step.name),
  )
  assert.equal(
    encodeFingerprint(CONFIG, trimmedMatroska),
    encodeFingerprint(CONFIG, trimmedMp4),
  )
  assert.notDeepEqual(
    expectedLadder(CONFIG, trimmedMatroska).map((step) => step.name),
    expectedLadder(CONFIG, {
      ...trimmedMatroska,
      trimStartMs: null,
      trimEndMs: null,
    }).map((step) => step.name),
  )
})

test("source fps 0 behaves as unknown instead of producing 1-fps steps", () => {
  const ladder = expectedLadder(CONFIG, {
    ...FACTS,
    height: 1440,
    sourceFps: 0,
    sourceContentType: "video/webm",
    sourceCodecs: null,
  })

  assert.equal(
    ladder.every((step) => step.capFps),
    true,
  )
  assert.equal(
    ladder.some((step) => step.fps === 1),
    false,
  )
})

test("empty ladder has a stable canonical form", () => {
  assert.equal(
    encodeFingerprint(CONFIG, {
      ...FACTS,
      height: 480,
    }),
    '{"p":"3","q":22,"a":128,"cut":null,"steps":[]}',
  )
})

test("fingerprint key order is stable for structurally equal inputs", () => {
  const left = encodeFingerprint(CONFIG, { ...FACTS })
  const right = encodeFingerprint(config(JSON.parse(JSON.stringify(CONFIG))), {
    ...JSON.parse(JSON.stringify(FACTS)),
  })

  assert.equal(left, right)
})

function config(input: Partial<TranscodingConfig>): TranscodingConfig {
  return TranscodingConfigSchema.parse(input)
}
