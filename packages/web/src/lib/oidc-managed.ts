import { t } from "@alloy/i18n"

/**
 * Explains a username the OIDC provider sets on every sign-in. The provider
 * name comes from the public auth config, which is null once SSO is off; the
 * server stops managing usernames then too, so the fallback only covers a
 * stale config.
 */
export function oidcUsernameNote(
  providerName: string | null | undefined,
): string {
  return providerName
    ? t("Synced from {provider} each time you sign in. Change it there.", {
        provider: providerName,
      })
    : t(
        "Synced from your sign-in provider each time you sign in. Change it there.",
      )
}
