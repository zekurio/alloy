import type { PublicAuthConfig } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Separator } from "@alloy/ui/components/separator"
import { Link } from "@tanstack/react-router"
import { useEffect } from "react"

import { OAuthSignIn } from "@/components/routes/login/oauth-sign-in"
import { canOidcSignUp } from "@/lib/auth-access"
import { authClient } from "@/lib/auth-client"
import { useSignedOut } from "@/lib/auth-hooks"
import { passkeysSupported } from "@/lib/passkey-support"

import { PasskeySignUpForm } from "./passkey-sign-up-form"

type SignUpPageInnerProps = {
  config: PublicAuthConfig
}

/**
 * Presentational sign-up card body. Renders the configured sign-up methods.
 * Shared by the real sign-up page and the admin login-appearance preview, so it
 * must stay free of redirect/navigation side effects.
 */
export function SignUpForm({
  config,
  passkeySupported,
}: {
  config: PublicAuthConfig
  passkeySupported: boolean
}) {
  const canPasskeySignUp = config.openRegistrations && config.passkeyEnabled
  const showPasskeySignUp = canPasskeySignUp && passkeySupported
  const oidcSignUp = canOidcSignUp(config) ? config.oidc : null
  const showSeparator = showPasskeySignUp && oidcSignUp !== null

  return (
    <>
      <div className="mb-8 space-y-1.5">
        <h2 className="text-foreground text-2xl font-semibold tracking-[-0.02em]">
          {t("Create your account")}
        </h2>
      </div>

      <div className="flex flex-col gap-5">
        {showPasskeySignUp ? (
          <div className="flex flex-col gap-3">
            <PasskeySignUpForm />
          </div>
        ) : null}

        {canPasskeySignUp && !passkeySupported ? (
          <p className="text-foreground-muted text-sm">
            {t(
              "Passkey sign-up is enabled, but this browser does not support passkeys.",
            )}
          </p>
        ) : null}

        {showSeparator ? (
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-foreground-muted text-xs font-medium tracking-wider uppercase">
              {t("or")}
            </span>
            <Separator className="flex-1" />
          </div>
        ) : null}

        {oidcSignUp ? (
          <div className="flex flex-col gap-3">
            <OAuthSignIn provider={oidcSignUp} />
          </div>
        ) : null}
      </div>

      <p className="text-foreground-muted mt-6 text-sm">
        {t("Already have an account?")}{" "}
        <Link
          to="/login"
          className="text-foreground hover:text-accent font-medium underline-offset-4 hover:underline"
        >
          {t("Sign in")}
        </Link>
      </p>
    </>
  )
}

export function SignUpPageInner({ config }: SignUpPageInnerProps) {
  const canRender = useSignedOut()
  const passkeySupported = passkeysSupported()

  useEffect(() => {
    if (config.passkeyEnabled && passkeySupported) {
      authClient.passkey.preload()
    }
  }, [config.passkeyEnabled, passkeySupported])

  if (!canRender) return null

  return <SignUpForm config={config} passkeySupported={passkeySupported} />
}
