import type { PublicAuthConfig, PublicAuthProvider } from "@alloy/api"
import { message, t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { useMutation } from "@tanstack/react-query"
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

  const createAccount = useMutation({
    // Resolves true once the server is creating the account and redirecting.
    mutationFn: async () => {
      const { error } = await authClient.oauth2.pending.signUp()
      if (!error) return true
      toastAuthAttemptFailure(
        "OAuth sign-up",
        message("OAuth sign-in failed"),
        error,
      )
      return false
    },
    onError: (cause) =>
      toastAuthAttemptFailure(
        "OAuth sign-up",
        message("OAuth sign-in failed"),
        cause,
      ),
    onSettled: (created) => {
      if (created) return
      // The server refuses while signed in, e.g. from another tab, so refresh
      // the session to show the link step. A failed attempt may also have
      // used up the pending sign-in.
      void completeAuthSessionFlow({
        invalidateRouter: () => router.invalidate(),
      })
    },
  })
  const pending = createAccount.isPending || createAccount.data === true

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
          // The form sits on the clip wall, so tint an opaque surface rather
          // than letting the wall show through the text.
          <Callout
            tone="info"
            className="mb-6 bg-[color-mix(in_srgb,var(--info)_12%,var(--surface))]"
          >
            <LinkIcon />
            <p>
              {t(
                "Your {provider} username matches an existing account. Sign in to that account to link {provider}.",
                { provider: displayName },
              )}
            </p>
          </Callout>
        }
        footer={
          provider.allowSignUp ? (
            <p className="text-foreground-muted mt-6 text-center text-sm">
              {t("Not your account?")}{" "}
              <button
                type="button"
                className="text-foreground hover:text-accent font-medium underline-offset-4 hover:underline disabled:opacity-50"
                disabled={pending}
                onClick={() => {
                  if (!pending) createAccount.mutate()
                }}
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
  const displayName = provider.displayName
  const confirm = useMutation({
    // Resolves true once the browser is leaving this page.
    mutationFn: async (choice: "link" | "skip") => {
      if (choice === "skip") {
        // It expires on its own, so leaving it behind is harmless.
        const { error } = await authClient.oauth2.pending
          .discard()
          .catch((cause: unknown) => ({ error: cause }))
        if (error)
          clientLogger.warn(
            "[auth] Discarding pending OAuth link failed.",
            error,
          )
        // The target may be a server path such as the desktop handshake.
        if (redirectTo) window.location.assign(redirectTo)
        else void navigate({ to: "/", replace: true })
        return true
      }
      // Goes back to where the OAuth sign-in started.
      const { error } = await authClient.oauth2.pending.link()
      if (!error) return true
      toastAuthAttemptFailure(
        "OAuth link",
        message("Couldn't link account"),
        error,
      )
      return false
    },
    onError: (cause) =>
      toastAuthAttemptFailure(
        "OAuth link",
        message("Couldn't link account"),
        cause,
      ),
    onSettled: (leaving) => {
      // A failed attempt may have used up the pending sign-in.
      if (!leaving) void router.invalidate()
    },
  })
  const pending = confirm.isPending || confirm.data === true
  const run = (choice: "link" | "skip") => {
    if (!pending) confirm.mutate(choice)
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
          onClick={() => run("link")}
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
          onClick={() => run("skip")}
        >
          {t("Not now")}
        </Button>
      </div>
    </>
  )
}
