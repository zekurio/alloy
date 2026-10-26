import type { PublicAuthConfig, PublicAuthProvider } from "@alloy/api"
import { message, t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { useLocation, useNavigate, useRouter } from "@tanstack/react-router"
import { LinkIcon } from "lucide-react"
import { useState } from "react"

import { SignInReactivationPrompt } from "@/components/account/reactivate-account-prompt"
import { authClient } from "@/lib/auth-client"
import {
  completeAuthSessionFlow,
  toastAuthAttemptFailure,
} from "@/lib/auth-flow"
import { clientLogger } from "@/lib/client-log"
import { usePasskeySupport } from "@/lib/passkey-support"
import { useSuspenseSession } from "@/lib/session-suspense"

import { LoginForm } from "./login-page-inner"

/** An OAuth sign-in the server holds for this browser until it's linked. */
export type PendingLink = {
  provider: PublicAuthProvider
  /** The provider's username claim. */
  accountLabel: string | null
}

type OAuthLinkPageProps = {
  config: PublicAuthConfig
  link: PendingLink
  redirectTo?: string
}

/**
 * Where an OAuth sign-in lands when its username claim names an existing
 * account. The server keeps that sign-in for this browser, so neither linking
 * it nor creating an account from it goes back to the provider. Signed out,
 * the page asks the user to sign in to the account; every sign-in method
 * returns here. Signed in, it links on a click and names the provider account,
 * so someone else on a shared browser can tell it isn't theirs.
 */
export function OAuthLinkPage({
  config,
  link,
  redirectTo,
}: OAuthLinkPageProps) {
  const session = useSuspenseSession()

  if (session) {
    return (
      <OAuthLinkConfirm
        link={link}
        username={session.user.username}
        redirectTo={redirectTo}
      />
    )
  }
  return <OAuthLinkSignIn config={config} link={link} />
}

function OAuthLinkSignIn({
  config,
  link: { provider },
}: Omit<OAuthLinkPageProps, "redirectTo">) {
  const router = useRouter()
  // This page, link param included, so signing in comes back to confirm.
  const returnTo = useLocation({ select: (location) => location.href })
  const [reactivationRequired, setReactivationRequired] = useState(false)
  const [pending, setPending] = useState(false)
  const { ready: passkeyReady, supported: passkeySupported } =
    usePasskeySupport()
  const displayName = provider.displayName
  // Signing in with the provider being linked would only match the claim
  // again and nest another link redirect.
  const signInConfig = {
    ...config,
    providers: config.providers.filter(
      (candidate) => candidate.providerId !== provider.providerId,
    ),
  }

  async function onCreateAccount() {
    if (pending) return
    setPending(true)
    try {
      const { error } = await authClient.oauth2.pending.signUp()
      if (!error) return
      toastAuthAttemptFailure(
        "OAuth sign-up",
        message("OAuth sign-in failed"),
        error,
      )
    } catch (cause) {
      toastAuthAttemptFailure(
        "OAuth sign-up",
        message("OAuth sign-in failed"),
        cause,
      )
    }
    setPending(false)
    // The server refuses while signed in, e.g. from another tab, so refresh
    // the session to show the link step. A failed attempt may also have used
    // up the pending sign-in.
    await completeAuthSessionFlow({
      invalidateRouter: () => router.invalidate(),
    })
  }

  return (
    <>
      <LoginForm
        config={signInConfig}
        passkeyReady={passkeyReady}
        passkeySupported={passkeySupported}
        redirectTo={returnTo}
        // A second unlinked provider would ask to link too and stack another
        // link page, so other providers only sign in to linked accounts.
        oauthAccount="linked"
        onReactivationRequired={() => setReactivationRequired(true)}
        notice={
          <Callout tone="info" className="mb-6">
            <LinkIcon />
            <p>
              {t(
                "An account with your {provider} username already exists. Sign in to it to link your {provider} account.",
                { provider: displayName },
              )}
            </p>
          </Callout>
        }
        footer={
          config.openRegistrations ? (
            <p className="text-foreground-muted mt-6 text-center text-sm">
              {t("Not your account?")}{" "}
              <button
                type="button"
                className="text-foreground hover:text-accent font-medium underline-offset-4 hover:underline disabled:opacity-50"
                disabled={pending}
                onClick={onCreateAccount}
              >
                {t("Create a new account")}
              </button>
            </p>
          ) : null
        }
      />
      <SignInReactivationPrompt
        open={reactivationRequired}
        redirectTo={returnTo}
        onDismiss={() => setReactivationRequired(false)}
      />
    </>
  )
}

function OAuthLinkConfirm({
  link: { provider, accountLabel },
  username,
  redirectTo,
}: {
  link: PendingLink
  username: string
  redirectTo?: string
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const displayName = provider.displayName

  async function onLink() {
    if (pending) return
    setPending(true)
    try {
      // Goes back to where the OAuth sign-in started.
      const { error } = await authClient.oauth2.pending.link()
      if (!error) return
      toastAuthAttemptFailure(
        "OAuth link",
        message("Couldn't link account"),
        error,
      )
    } catch (cause) {
      toastAuthAttemptFailure(
        "OAuth link",
        message("Couldn't link account"),
        cause,
      )
    }
    setPending(false)
    // A failed attempt may have used up the pending sign-in.
    await router.invalidate()
  }

  async function onSkip() {
    if (pending) return
    setPending(true)
    const { error } = await authClient.oauth2.pending.discard()
    // It expires on its own, so leaving it behind is harmless.
    if (error)
      clientLogger.warn("[auth] Discarding pending OAuth link failed.", error)
    // The target may be a server path such as the desktop handshake.
    if (redirectTo) window.location.assign(redirectTo)
    else void navigate({ to: "/", replace: true })
  }

  return (
    <>
      <div className="mb-8 space-y-1.5">
        <h2 className="text-foreground text-2xl font-semibold tracking-[-0.02em]">
          {t("Link {provider}", { provider: displayName })}
        </h2>
        <p className="text-foreground-muted text-sm">
          {accountLabel
            ? t(
                "Signed in as {username}. Link the {provider} account {account} to sign in with it next time.",
                { username, provider: displayName, account: accountLabel },
              )
            : t(
                "Signed in as {username}. Link your {provider} account to sign in with it next time.",
                { username, provider: displayName },
              )}
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          size="lg"
          className="w-full gap-3"
          disabled={pending}
          onClick={onLink}
        >
          <LinkIcon className="size-4" />
          {pending
            ? t("Linking…")
            : t("Link {provider}", { provider: displayName })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="w-full"
          disabled={pending}
          onClick={onSkip}
        >
          {t("Not now")}
        </Button>
      </div>
    </>
  )
}
