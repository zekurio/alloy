import { authClient } from "./auth-client"
import { clientLogger } from "./client-log"
import { publicOrigin } from "./env"
import { resetClientState } from "./query-client"

export function authCallbackUrl(path: string): string {
  return new URL(path, publicOrigin()).toString()
}

interface CompleteAuthSessionFlowOptions {
  invalidateRouter: () => Promise<unknown>
  navigate?: () => Promise<unknown> | unknown
}

export async function completeAuthSessionFlow({
  invalidateRouter,
  navigate,
}: CompleteAuthSessionFlowOptions): Promise<void> {
  await authClient.getSession()
  await invalidateRouter()
  await navigate?.()
}

export async function completeSignOutFlow({
  invalidateRouter,
}: {
  invalidateRouter: () => Promise<unknown>
}): Promise<void> {
  await authClient.signOut()
  resetClientState()
  await invalidateRouter()
}

export function reportAuthFlowFailure(
  action: string,
  fallbackMessage: string,
  cause: unknown
): string {
  clientLogger.warn(`[auth] ${action} failed.`, cause)
  return fallbackMessage
}
