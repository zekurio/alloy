import type { ClipRow } from "@alloy/api"

import { useReEncodeClipMutation } from "@/lib/clip-queries"

import { useClipAccess } from "./use-clip-access"

/**
 * Owner/admin retry affordance for a failed clip, rendered by the player's
 * failed state. `canRetry` gates the UI; the server re-checks ownership.
 * Re-encoding a *ready* clip is a separate admin-only action (see ClipMeta).
 */
export function useClipRetry(row: ClipRow) {
  const { canManage } = useClipAccess(row.authorId)
  const mutation = useReEncodeClipMutation()
  return {
    canRetry: canManage,
    retryPending: mutation.isPending && mutation.variables?.clipId === row.id,
    onRetry: () => mutation.mutate({ clipId: row.id }),
  }
}
