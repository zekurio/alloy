/** Smallest media range a trim may keep, in ms. */
export const TRIM_MIN_RANGE_MS = 1000

/** Slack when deciding whether a requested trim still covers the full clip. */
export const TRIM_FULL_RANGE_TOLERANCE_MS = 50

export type ResolvedTrimRange =
  | { kind: "invalid"; reason: string }
  | { kind: "full-range" }
  | { kind: "range"; startMs: number; endMs: number }

/**
 * Shared semantics for ingest-time trims (/initiate) and re-trims (/trim).
 * The media run separately re-clamps against the ffprobe'd duration as the
 * backstop.
 */
export function resolveTrimRange(input: {
  startMs: number
  endMs: number
  durationMs: number
}): ResolvedTrimRange {
  const startMs = Math.max(0, input.startMs)
  const endMs = Math.min(input.durationMs, input.endMs)
  // Client probes and packet math can disagree by a few ms, so a range that
  // legitimately reaches the media tail may overshoot `durationMs` slightly.
  // The requested range must meet the minimum, but the clamped range only
  // has to come within the full-range tolerance of it — otherwise a
  // minimum-length trim ending at the tail would be rejected.
  if (
    input.endMs - input.startMs < TRIM_MIN_RANGE_MS ||
    endMs - startMs < TRIM_MIN_RANGE_MS - TRIM_FULL_RANGE_TOLERANCE_MS
  ) {
    return { kind: "invalid", reason: "The trimmed range is too short" }
  }
  if (
    startMs <= TRIM_FULL_RANGE_TOLERANCE_MS &&
    endMs >= input.durationMs - TRIM_FULL_RANGE_TOLERANCE_MS
  ) {
    return { kind: "full-range" }
  }
  return { kind: "range", startMs, endMs }
}
