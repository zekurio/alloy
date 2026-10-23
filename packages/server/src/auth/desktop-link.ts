import { randomBase64Url, sha256Base64Url } from "@alloy/server/runtime/crypto"

import { consumeAuthChallenge, insertAuthChallenge } from "./challenges"

/**
 * One-time codes for the desktop browser-login handshake (RFC 8252 loopback).
 * The desktop app exchanges a code for a fresh session because the desktop
 * webview can't run WebAuthn, so login happens in the user's real browser and
 * hands the session back here.
 */
const DESKTOP_LINK_PURPOSE = "desktop-link"
const DESKTOP_LINK_TTL_MS = 2 * 60 * 1000

export async function createDesktopLinkCode(
  userId: string,
  codeChallenge: string,
): Promise<string> {
  const code = randomBase64Url(32)
  await insertAuthChallenge({
    purpose: DESKTOP_LINK_PURPOSE,
    identifier: code,
    challenge: codeChallenge,
    payload: {},
    userId,
    ttlMs: DESKTOP_LINK_TTL_MS,
  })
  return code
}

export async function consumeDesktopLinkCode(
  code: string,
  codeVerifier: string,
): Promise<string | null> {
  const challenge = await consumeAuthChallenge({
    purpose: DESKTOP_LINK_PURPOSE,
    identifier: code,
    challenge: await sha256Base64Url(codeVerifier),
  })
  return challenge?.user_id ?? null
}
