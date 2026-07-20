import assert from "node:assert/strict"
import { test } from "node:test"

import { DISCORD_OAUTH_PRESET, discordCdnAvatarUrl } from "@alloy/contracts"

import { OAuthProviderSchema } from "../config/oauth-schema"

test("the Discord preset plus client credentials is a valid provider", () => {
  const parsed = OAuthProviderSchema.safeParse({
    providerId: DISCORD_OAUTH_PRESET.providerId,
    displayName: DISCORD_OAUTH_PRESET.displayName,
    clientId: "client-id",
    enabled: true,
    authorizationUrl: DISCORD_OAUTH_PRESET.authorizationUrl,
    tokenUrl: DISCORD_OAUTH_PRESET.tokenUrl,
    userInfoUrl: DISCORD_OAUTH_PRESET.userInfoUrl,
    scopes: DISCORD_OAUTH_PRESET.scopes,
    uidClaim: DISCORD_OAUTH_PRESET.uidClaim,
    usernameClaim: DISCORD_OAUTH_PRESET.usernameClaim,
    avatarClaim: DISCORD_OAUTH_PRESET.avatarClaim,
    buttonColor: DISCORD_OAUTH_PRESET.buttonColor,
    buttonTextColor: DISCORD_OAUTH_PRESET.buttonTextColor,
    pkce: DISCORD_OAUTH_PRESET.pkce,
  })
  assert.equal(parsed.success, true)
})

test("discordCdnAvatarUrl builds the CDN URL from id + hash", () => {
  assert.equal(
    discordCdnAvatarUrl(
      "80351110224678912",
      "8342729096ea3675442027381ff50dfe",
    ),
    "https://cdn.discordapp.com/avatars/80351110224678912/8342729096ea3675442027381ff50dfe.png?size=256",
  )
  // Animated avatars carry an "a_" prefix; the CDN serves them as PNG too.
  assert.equal(
    discordCdnAvatarUrl("80351110224678912", "a_8342729096ea3675442027381f"),
    "https://cdn.discordapp.com/avatars/80351110224678912/a_8342729096ea3675442027381f.png?size=256",
  )
})

test("discordCdnAvatarUrl rejects missing or malformed parts", () => {
  assert.equal(discordCdnAvatarUrl("80351110224678912", null), null)
  assert.equal(
    discordCdnAvatarUrl(null, "8342729096ea3675442027381ff50dfe"),
    null,
  )
  assert.equal(discordCdnAvatarUrl("not-a-snowflake", "abc"), null)
  assert.equal(discordCdnAvatarUrl("80351110224678912", "../../evil"), null)
  assert.equal(discordCdnAvatarUrl("80351110224678912", ""), null)
})
