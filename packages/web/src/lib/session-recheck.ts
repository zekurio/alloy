import { HttpError } from "@alloy/api"

import { authClient } from "./auth-client"
import { clientLogger } from "./client-log"

type SessionEndedHandler = () => Promise<void>

let onSessionEnded: SessionEndedHandler | null = null
let pendingRecheck: Promise<void> | null = null

/** Set what runs once the server no longer recognizes this client's session. */
export function setSessionEndedHandler(handler: SessionEndedHandler): void {
  onSessionEnded = handler
}

/**
 * Ask the server whether this client is still signed in. The session store
 * loads once at boot, so without this a session that was signed out from
 * another device, or that expired, stays signed in here until a reload, with
 * every request failing. Concurrent callers share one request.
 */
export function recheckSession(): Promise<void> {
  if (!authClient.$store.getSnapshot().data) return Promise.resolve()
  pendingRecheck ??= authClient.$store
    .refetch()
    .then(async ({ data }) => {
      if (!data) await onSessionEnded?.()
    })
    .catch((cause: unknown) => {
      clientLogger.warn("[auth] Failed to re-check session.", cause)
    })
    .finally(() => {
      pendingRecheck = null
    })
  return pendingRecheck
}

/** Re-check the session when a request fails with 401 Unauthorized. */
export function recheckSessionOnUnauthorized(cause: unknown): void {
  if (cause instanceof HttpError && cause.status === 401) void recheckSession()
}
