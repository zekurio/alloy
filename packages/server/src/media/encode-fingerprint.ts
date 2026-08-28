import { createHash } from "node:crypto"

import type { TranscodingConfig } from "@alloy/contracts"

import { MEDIA_PIPELINE_VERSION } from "./pipeline-version"
import { effectiveLadder, type LadderStep } from "./renditions"

export interface FingerprintSourceFacts {
  height: number
  sourceFps: number | null
  trimStartMs: number | null
  trimEndMs: number | null
  /** Probed stem count/codecs plus validated semantic metadata. */
  audioTrackFingerprint: string | null
}

export function expectedLadder(
  config: TranscodingConfig,
  facts: FingerprintSourceFacts,
): LadderStep[] {
  return effectiveLadder(config, {
    height: facts.height,
    fps: facts.sourceFps === 0 ? null : facts.sourceFps,
  })
}

export function persistedSourceFps(fps: number | null): number {
  if (fps === null || !Number.isFinite(fps)) return 0
  return Math.round(fps)
}

export function encodeFingerprint(
  config: TranscodingConfig,
  facts: FingerprintSourceFacts,
): string {
  return JSON.stringify({
    p: MEDIA_PIPELINE_VERSION,
    q: config.quality,
    a: config.audioBitrateKbps,
    cut:
      facts.trimStartMs === null || facts.trimEndMs === null
        ? null
        : [facts.trimStartMs, facts.trimEndMs],
    at: facts.audioTrackFingerprint
      ? createHash("sha256")
          .update(facts.audioTrackFingerprint)
          .digest("hex")
          .slice(0, 16)
      : undefined,
    steps: expectedLadder(config, facts).map((step) => ({
      n: step.name,
      h: step.height,
      fps: step.fps,
      cap: step.capFps,
      mr: step.tier.maxrateKbps,
      c: step.codec,
      og: step.og,
    })),
  })
}
