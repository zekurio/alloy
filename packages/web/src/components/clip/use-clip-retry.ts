import type { ClipRow } from "@alloy/api"

import { useSession } from "@/lib/auth-client"
import { useReEncodeClipMutation } from "@/lib/clip-queries"

/**
 * Owner/admin retry affordance for a failed clip, rendered by the player's
 * failed state. `canRetry` gates the UI; the server re-checks ownership.
 * Re-encoding a *ready* clip is a separate admin-only action (see ClipMeta).
 */
export function useClipRetry(row: ClipRow) {
  const { data: session } = useSession()
  const viewerId = session?.user?.id ?? null
  const role =
    (session?.user as { role?: string | null } | undefined)?.role ?? null
  const canRetry =
    (viewerId !== null && viewerId === row.authorId) || role === "admin"
  const mutation = useReEncodeClipMutation()
  return {
    canRetry,
    retryPending: mutation.isPending && mutation.variables?.clipId === row.id,
    onRetry: () => mutation.mutate({ clipId: row.id }),
  }
}
