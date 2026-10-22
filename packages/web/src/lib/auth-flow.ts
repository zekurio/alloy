import { isAbortError } from "@alloy/api"
import { t } from "@alloy/i18n"
import { messageFromUnknown } from "@alloy/ui/lib/error-message"
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
  invalidateRouter: () => Promise<void>
  navigate?: () => Promise<void> | void
}

export async function completeAuthSessionFlow({
  invalidateRouter,
  navigate,
}: CompleteAuthSessionFlowOptions): Promise<void> {
  await authClient.getSession()
  await invalidateRouter()
  await navigate?.()
}

interface CompleteSignOutFlowOptions {
  invalidateRouter: () => Promise<void>
  navigate?: () => Promise<void> | void
}

async function leaveSignedInState({
  invalidateRouter,
  navigate,
}: CompleteSignOutFlowOptions): Promise<void> {
  resetClientState()
  await invalidateRouter()
  await navigate?.()
}

export async function completeSignOutFlow(
  options: CompleteSignOutFlowOptions,
): Promise<void> {
  const { error } = await authClient.signOut()
  if (error) throw error
  await leaveSignedInState(options)
}

/**
 * Signs out and clears client state after the account itself was disabled or
 * deleted. That change already succeeded and the server may have ended the
 * session with it, so a failed sign-out is logged rather than reported.
 */
export async function completeAccountExitFlow(
  options: CompleteSignOutFlowOptions,
): Promise<void> {
  const { error } = await authClient.signOut()
  if (error)
    clientLogger.warn("[auth] Sign-out after account exit failed.", error)
  await leaveSignedInState(options)
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
  return cause instanceof Error ? cause.name : null
}

function causeMessage(cause: unknown): string | null {
  return messageFromUnknown(cause)
}

export function isAuthAttemptCancellation(cause: unknown): boolean {
  if (isAbortError(cause) || causeName(cause) === "NotAllowedError") {
    return true
  }

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
  // Server error bodies and fallbacks are English source strings; t()
  // localizes known messages and passes unknown ones through unchanged.
  toast.error(t(errorMessage(cause, fallbackMessage)))
}
