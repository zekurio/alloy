import { t } from "@alloy/i18n"

/**
 * Explains a profile field the OIDC provider sets on every sign-in. The
 * provider name comes from the public auth config, which is null once SSO is
 * off; the server stops managing fields then too, so the fallback only covers
 * a stale config.
 */
export function oidcSyncedNote(
  field: "username" | "avatar",
  providerName: string | null | undefined,
): string {
  if (field === "username") {
    return providerName
      ? t("Synced from {provider} each time you sign in. Change it there.", {
          provider: providerName,
        })
      : t(
          "Synced from your sign-in provider each time you sign in. Change it there.",
        )
  }
  return providerName
    ? t("Your avatar is synced from {provider} each time you sign in.", {
        provider: providerName,
      })
    : t(
        "Your avatar is synced from your sign-in provider each time you sign in.",
      )
}
