import assert from "node:assert/strict"
import test from "node:test"

const secret = "0123456789abcdef0123456789abcdef"

process.env.DATABASE_URL = "postgres://alloy:alloy@localhost:5432/alloy"
process.env.ALLOY_VIEWER_COOKIE_SECRET = secret
process.env.ALLOY_UPLOAD_HMAC_SECRET = secret

const { parseServerEnv } = await import("../env")

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: "postgres://alloy:alloy@localhost:5432/alloy",
    ALLOY_VIEWER_COOKIE_SECRET: secret,
    ALLOY_UPLOAD_HMAC_SECRET: secret,
    ...overrides,
  }
}

test("rejects missing required internal signing secrets", () => {
  assert.throws(
    () =>
      parseServerEnv(
        baseEnv({
          ALLOY_UPLOAD_HMAC_SECRET: undefined,
        }),
      ),
    /ALLOY_UPLOAD_HMAC_SECRET is required/,
  )
})

test("rejects unsupported storage driver", () => {
  assert.throws(
    () =>
      parseServerEnv(
        baseEnv({
          ALLOY_STORAGE_DRIVER: "s3",
        }),
      ),
    /ALLOY_STORAGE_DRIVER/,
  )
})

test("configures filesystem thumbnail storage separately", () => {
  const parsed = parseServerEnv(
    baseEnv({
      ALLOY_STORAGE_FS_CLIPS_PATH: "/tank/alloy/clips",
      ALLOY_STORAGE_FS_THUMBNAILS_PATH: "/fast/alloy/thumbnails",
      ALLOY_STORAGE_FS_USERS_PATH: "/var/lib/alloy/assets",
      ALLOY_STORAGE_FS_GAMES_PATH: "/var/lib/alloy/games",
    }),
  )

  assert.deepEqual(parsed.storage, {
    driver: "fs",
    fs: {
      clipsPath: "/tank/alloy/clips",
      thumbnailsPath: "/fast/alloy/thumbnails",
      usersPath: "/var/lib/alloy/assets",
      gamesPath: "/var/lib/alloy/games",
    },
  })
})

test("maps Paperless-style OIDC JSON to Alloy provider config", () => {
  const providers = {
    openid_connect: {
      SCOPE: ["openid", "profile", "email"],
      OAUTH_PKCE_ENABLED: false,
      APPS: [
        {
          provider_id: "zitadel",
          name: "Zitadel",
          client_id: "client-id",
          secret: "client-secret",
          settings: {
            server_url: "https://id.example.com",
            token_auth_method: "client_secret_basic",
            uid_field: "sub_id",
            fetch_userinfo: false,
            auth_params: {
              prompt: "login",
              max_age: 60,
            },
            icon_url: "https://id.example.com/icon.svg",
            button_color: "111111",
            button_text_color: "ffffff",
            username_claim: "preferred_username",
            quota_claim: "quota_gib",
            role_claim: "groups",
          },
        },
      ],
    },
  }

  const parsed = parseServerEnv(
    baseEnv({
      ALLOY_SOCIALACCOUNT_PROVIDERS: JSON.stringify(providers),
    }),
  )

  assert.deepEqual(parsed.oauthClientSecrets, { zitadel: "client-secret" })
  assert.equal(parsed.oauthProviders.length, 1)
  assert.deepEqual(parsed.oauthProviders[0], {
    providerId: "zitadel",
    displayName: "Zitadel",
    clientId: "client-id",
    scopes: ["openid", "profile", "email"],
    enabled: true,
    buttonColor: "#111111",
    buttonTextColor: "#ffffff",
    iconUrl: "https://id.example.com/icon.svg",
    discoveryUrl: "https://id.example.com",
    authorizationUrl: undefined,
    tokenUrl: undefined,
    userInfoUrl: undefined,
    pkce: false,
    tokenAuthMethod: "client_secret_basic",
    uidClaim: "sub_id",
    fetchUserInfo: false,
    authParams: {
      prompt: "login",
      max_age: "60",
    },
    usernameClaim: "preferred_username",
    avatarClaim: "picture",
    quotaClaim: "quota_gib",
    roleClaim: "groups",
  })
})

test("maps Discord OIDC JSON to subject-claim config", () => {
  const providers = {
    openid_connect: {
      SCOPE: ["openid", "identify", "email"],
      OAUTH_PKCE_ENABLED: true,
      APPS: [
        {
          provider_id: "discord",
          name: "Discord",
          client_id: "discord-client-id",
          secret: "discord-client-secret",
          settings: {
            discovery_url:
              "https://discord.com/.well-known/openid-configuration",
            username_claim: "preferred_username",
            avatar_claim: "custom_picture",
            button_color: "5865F2",
            button_text_color: "ffffff",
            icon_url: "https://cdn.simpleicons.org/discord/white",
          },
        },
      ],
    },
  }

  const parsed = parseServerEnv(
    baseEnv({
      ALLOY_SOCIALACCOUNT_PROVIDERS: JSON.stringify(providers),
    }),
  )

  assert.deepEqual(parsed.oauthClientSecrets, {
    discord: "discord-client-secret",
  })
  assert.deepEqual(parsed.oauthProviders[0], {
    providerId: "discord",
    displayName: "Discord",
    clientId: "discord-client-id",
    scopes: ["openid", "identify", "email"],
    enabled: true,
    buttonColor: "#5865F2",
    buttonTextColor: "#ffffff",
    iconUrl: "https://cdn.simpleicons.org/discord/white",
    discoveryUrl: "https://discord.com/.well-known/openid-configuration",
    authorizationUrl: undefined,
    tokenUrl: undefined,
    userInfoUrl: undefined,
    pkce: true,
    tokenAuthMethod: undefined,
    uidClaim: "sub",
    fetchUserInfo: true,
    authParams: undefined,
    usernameClaim: "preferred_username",
    avatarClaim: "custom_picture",
    quotaClaim: "alloy_quota",
    roleClaim: "alloy_role",
  })
})

test("rejects unsupported social account providers", () => {
  assert.throws(
    () =>
      parseServerEnv(
        baseEnv({
          ALLOY_SOCIALACCOUNT_PROVIDERS: JSON.stringify({
            github: { APPS: [] },
          }),
        }),
      ),
    /Invalid ALLOY_SOCIALACCOUNT_PROVIDERS/,
  )
})
