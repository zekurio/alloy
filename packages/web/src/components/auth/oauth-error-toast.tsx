import { message, t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { useLocation } from "@tanstack/react-router"
import { useEffect } from "react"

import { isAuthAttemptCancellation } from "@/lib/auth-flow"
import { consumeCurrentQueryParam } from "@/lib/browser-url"

const OAUTH_ERROR_QUERY_KEY = "oauth_error"
const OAUTH_ERROR_FALLBACK = message("OAuth sign-in failed.")

// Messages the server's OAuth callback redirects with. Anyone can link to
// `?oauth_error=…`, so any other value shows the generic failure instead of
// putting arbitrary text in a toast on this origin.
const KNOWN_OAUTH_ERRORS: ReadonlySet<string> = new Set([
  message("Account not found."),
  message("Account state changed during sign-in. Try again."),
  message("Could not allocate a unique username"),
  message("Could not create user."),
  message("Could not link OAuth account."),
  message("Missing OAuth state."),
  message(
    "No Alloy account is linked to this OAuth account. Sign in with another method and link it from settings.",
  ),
  message("OAuth account is already linked to another user."),
  message("OAuth profile is missing a subject."),
  message("OAuth provider changed during sign-in."),
  message("OAuth provider endpoints are incomplete."),
  message("OAuth provider is not enabled."),
  message("OAuth sign-in did not start in this browser."),
  message("OAuth sign-in expired. Try again."),
  message("OAuth state payload is invalid."),
  message("Sign in again before linking this account."),
  message("This account has been banned by an administrator."),
  OAUTH_ERROR_FALLBACK,
])

export function OAuthErrorToast() {
  const location = useLocation()

  useEffect(() => {
    const error = consumeCurrentQueryParam(OAUTH_ERROR_QUERY_KEY)
    if (!error) return

    if (isAuthAttemptCancellation(error)) {
      toast.warning(t("Auth attempt cancelled."))
      return
    }
    toast.error(t(KNOWN_OAUTH_ERRORS.has(error) ? error : OAUTH_ERROR_FALLBACK))
  }, [location.href])

  return null
}
