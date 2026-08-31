import type { ClipRow, QueueClip } from "@alloy/api"

type ClipEncodingFields = Pick<
  ClipRow | QueueClip,
  "status" | "encodeActive" | "encodeProgress" | "encodeStage" | "failureReason"
>

/** Whether media work is queued or running for this clip. */
export function clipEncodingActive(row: ClipEncodingFields): boolean {
  if (row.encodeActive !== undefined) return row.encodeActive
  if (row.status === "processing") return true
  if (row.status !== "ready" || row.failureReason !== null) return false

  // Contract-1 servers from before encodeActive exposed only progress/stage.
  return row.encodeStage !== null || row.encodeProgress < 100
}

/** A ready clip keeps playing its committed media during this work. */
export function clipReencodingActive(row: ClipEncodingFields): boolean {
  return row.status === "ready" && clipEncodingActive(row)
}
