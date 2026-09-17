import {
  publicOAuthProviderIconUrl,
  type OAuthProviderConfig,
  type PublicAuthProvider,
} from "@alloy/contracts"
import { isOAuthProviderUsable } from "@alloy/server/config/secret-store"
import { configStore } from "@alloy/server/config/store"

// Only enabled providers with a stored secret are usable for sign-in (see
// isOAuthProviderUsable). Enforcing it here means no config path (boot, reload,
// import, hand-edit) can surface an enabled-but-secretless provider.
function getEnabledProviderConfigs(): OAuthProviderConfig[] {
  return configStore
    .get("oauthProviders")
    .filter((provider) => isOAuthProviderUsable(provider))
}

export function getEnabledProviderConfig(
  providerId: string,
): OAuthProviderConfig | null {
  const provider = configStore
    .get("oauthProviders")
    .find((candidate) => candidate.providerId === providerId)
  return provider && isOAuthProviderUsable(provider) ? provider : null
}

export function getPublicProviders(): PublicAuthProvider[] {
  return getEnabledProviderConfigs().map((provider) => ({
    providerId: provider.providerId,
    displayName: provider.displayName,
    buttonColor: provider.buttonColor,
    buttonTextColor: provider.buttonTextColor,
    // Browsers only ever receive same-origin managed icon paths. External
    // icon URLs (possible via env icon_url or legacy stored config) are
    // withheld rather than proxied.
    iconUrl: publicOAuthProviderIconUrl(provider.iconUrl),
  }))
}
