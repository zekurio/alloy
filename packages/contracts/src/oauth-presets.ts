/**
 * First-party OAuth provider presets. A preset prefills every provider field
 * except the client ID and secret, so admins only paste credentials from the
 * provider's developer portal. Presets are keyed by their fixed `providerId`;
 * server-side behavior (like Discord's avatar-hash CDN handling) also keys on
 * that id.
 */
export interface OAuthProviderPreset {
  providerId: string
  displayName: string
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  scopes: string[]
  uidClaim: string
  usernameClaim: string
  avatarClaim: string
  buttonColor: string
  buttonTextColor: string
  pkce: boolean
}

export const DISCORD_PROVIDER_ID = "discord"

export const DISCORD_OAUTH_PRESET: OAuthProviderPreset = {
  providerId: DISCORD_PROVIDER_ID,
  displayName: "Discord",
  authorizationUrl: "https://discord.com/oauth2/authorize",
  tokenUrl: "https://discord.com/api/oauth2/token",
  userInfoUrl: "https://discord.com/api/users/@me",
  // `identify` covers id/username/avatar; `email` lets first-time OAuth
  // sign-in create an Alloy account (account creation requires an email).
  scopes: ["identify", "email"],
  uidClaim: "id",
  usernameClaim: "username",
  // Discord returns an avatar *hash*, not a URL; the server builds the CDN
  // URL via discordCdnAvatarUrl().
  avatarClaim: "avatar",
  buttonColor: "#5865F2",
  buttonTextColor: "#FFFFFF",
  pkce: true,
}

export const OAUTH_PROVIDER_PRESETS: readonly OAuthProviderPreset[] = [
  DISCORD_OAUTH_PRESET,
]

const DISCORD_SNOWFLAKE_RE = /^\d{1,20}$/
const DISCORD_AVATAR_HASH_RE = /^[a-z0-9_]{1,64}$/i

/**
 * CDN URL for a Discord user avatar. Discord's userinfo carries an avatar
 * hash instead of a URL; null when either part is missing or malformed
 * (users without a custom avatar have a null hash).
 */
export function discordCdnAvatarUrl(
  userId: unknown,
  avatarHash: unknown,
): string | null {
  if (typeof userId !== "string" || !DISCORD_SNOWFLAKE_RE.test(userId)) {
    return null
  }
  if (
    typeof avatarHash !== "string" ||
    !DISCORD_AVATAR_HASH_RE.test(avatarHash)
  ) {
    return null
  }
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=256`
}
