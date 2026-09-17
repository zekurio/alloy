import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

import {
  managedOAuthProviderIconKey,
  OAUTH_PROVIDER_ICON_KEY_RE,
  oauthProviderIconPath,
  publicOAuthProviderIconUrl,
} from "@alloy/contracts"
import { parseImageBytes } from "@alloy/server/media/image-validation"
import sharp from "sharp"
import { test } from "vitest"

import { OAuthProviderSubmissionSchema } from "../config/oauth-schema"
import {
  fetchOAuthProviderIconFromUrl,
  OAUTH_PROVIDER_ICON_MAX_BYTES,
  oauthProviderIconKey,
  prepareOAuthProviderIcon,
} from "./oauth-provider-icons"

const SVG_ICON = `<?xml version="1.0"?><!-- brand --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>`

function pngIcon(width = 64, height = 64): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: "#5865f2" },
  })
    .png()
    .toBuffer()
}

test("managed icon keys round-trip through paths and reject foreign shapes", () => {
  const key = oauthProviderIconKey("discord", randomUUID())
  assert.ok(OAUTH_PROVIDER_ICON_KEY_RE.test(key))
  assert.equal(managedOAuthProviderIconKey(oauthProviderIconPath(key)), key)
  assert.equal(
    managedOAuthProviderIconKey(`${oauthProviderIconPath(key)}?v=1`),
    key,
  )

  for (const value of [
    undefined,
    "",
    "https://cdn.example/icon.png",
    "/api/assets/auth/providers/discord/icon-nothex.webp",
    "/api/assets/auth/providers/UPPER/icon-" + "a".repeat(32) + ".webp",
    "/api/assets/games/providers/discord/icon-" + "a".repeat(32) + ".webp",
    "/api/assets/auth/providers/../providers/x/icon-" +
      "a".repeat(32) +
      ".webp",
  ]) {
    assert.equal(managedOAuthProviderIconKey(value), null, String(value))
  }

  assert.throws(() => oauthProviderIconKey("Bad_Provider", randomUUID()))
  assert.throws(() => oauthProviderIconKey("discord", "not-a-uuid"))
})

test("browsers only receive managed icon paths", () => {
  const managed = oauthProviderIconPath(
    oauthProviderIconKey("acme", randomUUID()),
  )
  assert.equal(publicOAuthProviderIconUrl(managed), managed)
  assert.equal(
    publicOAuthProviderIconUrl("data:image/svg+xml,%3Csvg%3E"),
    undefined,
  )
  assert.equal(
    publicOAuthProviderIconUrl("https://cdn.simpleicons.org/discord/white"),
    undefined,
  )
  assert.equal(publicOAuthProviderIconUrl("data:text/html,x"), undefined)
  assert.equal(publicOAuthProviderIconUrl(undefined), undefined)
})

test("icon preparation normalizes raster and svg sources and rejects junk", async () => {
  const fromPng = await prepareOAuthProviderIcon(await pngIcon(600, 300))
  assert.ok(fromPng.ok)
  const webp = parseImageBytes(fromPng.bytes)
  assert.equal(webp?.contentType, "image/webp")
  assert.ok((webp?.width ?? 0) <= 128 && (webp?.height ?? 0) <= 128)

  const fromSvg = await prepareOAuthProviderIcon(
    new TextEncoder().encode(SVG_ICON),
  )
  assert.ok(fromSvg.ok)
  assert.equal(parseImageBytes(fromSvg.bytes)?.contentType, "image/webp")

  const empty = await prepareOAuthProviderIcon(new Uint8Array())
  assert.deepEqual(empty, { ok: false, status: 400, error: "Empty image data" })

  const junk = await prepareOAuthProviderIcon(
    new TextEncoder().encode("<html><body>not an image"),
  )
  assert.equal(junk.ok, false)
  assert.equal(junk.ok ? undefined : junk.status, 400)

  const oversized = await prepareOAuthProviderIcon(
    new Uint8Array(OAUTH_PROVIDER_ICON_MAX_BYTES + 1),
  )
  assert.equal(oversized.ok ? undefined : oversized.status, 413)
})

test("icon URL ingestion is an SSRF boundary", async () => {
  for (const url of [
    "ftp://icons.example/icon.png",
    "file:///etc/passwd",
    "data:image/png;base64,AAAA",
    "not a url",
  ]) {
    const result = await fetchOAuthProviderIconFromUrl(url)
    assert.equal(result.ok, false, url)
    assert.equal(result.ok ? undefined : result.status, 400, url)
  }

  // Loopback and private hosts must be refused before any request is made.
  const loopback = await fetchOAuthProviderIconFromUrl(
    "http://127.0.0.1:9/icon.png",
  )
  assert.equal(loopback.ok, false)
  assert.match(loopback.ok ? "" : loopback.error, /public address/)

  const privateHost = await fetchOAuthProviderIconFromUrl(
    "http://10.0.0.8/icon.png",
  )
  assert.equal(privateHost.ok, false)
  assert.match(privateHost.ok ? "" : privateHost.error, /public address/)
})

test("provider submissions reject managed icon paths owned by other providers", () => {
  const foreignIcon = oauthProviderIconPath(
    oauthProviderIconKey("other", randomUUID()),
  )
  const base = {
    providerId: "acme",
    displayName: "Acme",
    clientId: "client",
    enabled: true,
    discoveryUrl: "https://idp.example/.well-known/openid-configuration",
  }

  assert.equal(
    OAuthProviderSubmissionSchema.safeParse({ ...base, iconUrl: foreignIcon })
      .success,
    false,
  )
  assert.ok(
    OAuthProviderSubmissionSchema.safeParse({
      ...base,
      iconUrl: oauthProviderIconPath(
        oauthProviderIconKey("acme", randomUUID()),
      ),
    }).success,
  )
  assert.ok(
    OAuthProviderSubmissionSchema.safeParse({
      ...base,
      iconUrl: "https://cdn.example/icon.png",
    }).success,
  )
})
