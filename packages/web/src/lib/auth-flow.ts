import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"

import { authClient } from "./auth-client"
import { clientLogger } from "./client-log"
import { publicOrigin } from "./env"
import { errorMessage } from "./error-message"
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
  navigate,
}: {
  invalidateRouter: () => Promise<unknown>
  navigate?: () => Promise<unknown> | unknown
}): Promise<void> {
  const { error } = await authClient.signOut()
  if (error) throw error
  resetClientState()
  await invalidateRouter()
  await navigate?.()
}

export function reportAuthFlowFailure(
  action: string,
  fallbackMessage: string,
  cause: unknown,
): string {
  clientLogger.warn(`[auth] ${action} failed.`, cause)
  return fallbackMessage
}

function causeName(cause: unknown): string | null {
  if (cause instanceof Error) return cause.name
  if (
    cause &&
    typeof cause === "object" &&
    "name" in cause &&
    typeof cause.name === "string"
  ) {
    return cause.name
  }
  return null
}

function causeMessage(cause: unknown): string | null {
  if (typeof cause === "string") return cause
  if (cause instanceof Error) return cause.message
  if (
    cause &&
    typeof cause === "object" &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    return cause.message
  }
  return null
}

export function isAuthAttemptCancellation(cause: unknown): boolean {
  const name = causeName(cause)
  if (name === "AbortError" || name === "NotAllowedError") return true

  const message = causeMessage(cause)?.toLowerCase()
  if (!message) return false

  return (
    message.includes("access_denied") ||
    message.includes("abort") ||
    message.includes("cancel") ||
    message.includes("not allowed") ||
    message.includes("timed out")
  )
}

export function toastAuthAttemptFailure(
  action: string,
  fallbackMessage: string,
  cause: unknown,
): void {
  clientLogger.warn(`[auth] ${action} failed.`, cause)
  if (isAuthAttemptCancellation(cause)) {
    toast.warning(t("Auth attempt cancelled."))
    return
  }
  toast.error(errorMessage(cause, fallbackMessage))
}
