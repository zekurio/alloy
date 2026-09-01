import type { ClipStatus, TranscodingConfig } from "@alloy/contracts"
import {
  encodeFingerprint,
  type FingerprintSourceFacts,
} from "@alloy/server/media/encode-fingerprint"

export type ClipMediaAction =
  | "full"
  | "waveform"
  | "thumbnail"
  | "skip"
  | "quarantine"

export const CLIP_MEDIA_FAILURE_ID_PREFIX = "clip-media:"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ClipMediaPolicyInput {
  force: boolean
  status: ClipStatus
  facts: FingerprintSourceFacts | null
  encodeFingerprint: string | null
  encodeFailedFingerprint: string | null
  encodeFailedGeneration: number | null
  hasSource: boolean
  hasAudio: boolean
  hasWaveform: boolean
  hasCut: boolean
  hasThumbnail: boolean
  thumbnailFailed: boolean
  config: Readonly<TranscodingConfig>
  retryFailuresGeneration: number
}

export function chooseClipMediaAction(
  input: ClipMediaPolicyInput,
): ClipMediaAction {
  if (input.force || input.status !== "ready" || !input.facts) return "full"
  const expected = encodeFingerprint(input.config, input.facts)
  if (
    input.encodeFailedFingerprint === expected &&
    (input.encodeFailedGeneration ?? 0) >= input.retryFailuresGeneration
  ) {
    return "quarantine"
  }
  if (input.encodeFingerprint !== expected) return "full"
  const needsCut =
    input.facts.trimStartMs !== null && input.facts.trimEndMs !== null
  if (input.hasCut !== needsCut) return "full"
  if (input.hasAudio !== input.hasWaveform) return "waveform"
  if (!input.hasThumbnail && !input.thumbnailFailed && input.hasSource) {
    return "thumbnail"
  }
  return "skip"
}

export function clipMediaRetryDelayMs(attempt: number): number {
  return 30_000 * attempt
}

export function clipIdFromMediaFailureId(value: string): string | null {
  if (!value.startsWith(CLIP_MEDIA_FAILURE_ID_PREFIX)) return null
  const clipId = value.slice(CLIP_MEDIA_FAILURE_ID_PREFIX.length)
  return UUID_PATTERN.test(clipId) ? clipId : null
}
