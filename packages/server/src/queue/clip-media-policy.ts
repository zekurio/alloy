import type { ClipStatus, TranscodingConfig } from "@alloy/contracts"
import {
  encodeFingerprint,
  type FingerprintSourceFacts,
} from "@alloy/server/media/encode-fingerprint"

export type ClipMediaAction = "full" | "thumbnail" | "skip" | "quarantine"

export const CLIP_MEDIA_FAILURE_ID_PREFIX = "clip-media:"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ClipMediaAdminCounts {
  pending: number
  running: number
  failed: number
  completed: number
}

export interface ClipMediaPolicyInput {
  force: boolean
  status: ClipStatus
  facts: FingerprintSourceFacts | null
  encodeFingerprint: string | null
  encodeFailedFingerprint: string | null
  encodeFailedGeneration: number | null
  hasSource: boolean
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
  if (input.encodeFingerprint === expected) {
    if (!input.hasThumbnail && !input.thumbnailFailed && input.hasSource) {
      return "thumbnail"
    }
    return "skip"
  }
  if (
    input.encodeFailedFingerprint === expected &&
    (input.encodeFailedGeneration ?? 0) >= input.retryFailuresGeneration
  ) {
    return "quarantine"
  }
  return "full"
}

export function clipMediaRetryDelayMs(attempt: number): number {
  return 30_000 * attempt
}

export function clipMediaFailureId(clipId: string): string {
  return `${CLIP_MEDIA_FAILURE_ID_PREFIX}${clipId}`
}

export function clipIdFromMediaFailureId(value: string): string | null {
  if (!value.startsWith(CLIP_MEDIA_FAILURE_ID_PREFIX)) return null
  const clipId = value.slice(CLIP_MEDIA_FAILURE_ID_PREFIX.length)
  return UUID_PATTERN.test(clipId) ? clipId : null
}

export function legacyRenditionOperationCounts(
  counts: ClipMediaAdminCounts,
): ClipMediaAdminCounts {
  return {
    pending: counts.pending,
    running: counts.running,
    failed: counts.failed,
    completed: 0,
  }
}
