import type { ClipRow } from "@alloy/api"

import { useSession } from "@/lib/auth-client"
import { useReEncodeClipMutation } from "@/lib/clip-queries"

/**
 * Owner/admin re-encode affordance for a clip, shared by the watch-page player
 * (failed-state retry) and the metadata menu. `canRetry` gates the UI; the
 * server re-checks ownership.
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
