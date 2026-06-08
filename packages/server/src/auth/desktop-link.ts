import { authChallenge } from "alloy-db/auth-schema"
import { and, eq, gt, lt } from "drizzle-orm"

import { db } from "../db"
import { randomBase64Url, sha256Base64Url } from "../runtime/crypto"

/**
 * One-time codes for the desktop browser-login handshake (RFC 8252 loopback).
 * Reuses the `auth_challenge` table — same shape as OAuth state and WebAuthn
 * challenges: short-lived, single-use, swept by `expires_at`. The desktop app
 * exchanges a code for a fresh session because Electron can't run WebAuthn, so
 * login happens in the user's real browser and hands the session back here.
 */
const DESKTOP_LINK_PURPOSE = "desktop-link"
const DESKTOP_LINK_TTL_MS = 2 * 60 * 1000

export async function deleteExpiredDesktopLinkCodes(): Promise<void> {
  await db
    .delete(authChallenge)
    .where(
      and(
        eq(authChallenge.purpose, DESKTOP_LINK_PURPOSE),
        lt(authChallenge.expiresAt, new Date()),
      ),
    )
}

export async function createDesktopLinkCode(
  userId: string,
  codeChallenge: string,
): Promise<string> {
  // Best-effort sweep of abandoned codes, mirroring the OAuth-state pattern.
  await deleteExpiredDesktopLinkCodes().catch(() => {})

  const code = randomBase64Url(32)
  await db.insert(authChallenge).values({
    purpose: DESKTOP_LINK_PURPOSE,
    identifier: code,
    challenge: codeChallenge,
    payload: { userId },
    expiresAt: new Date(Date.now() + DESKTOP_LINK_TTL_MS),
  })
  return code
}

export async function consumeDesktopLinkCode(
  code: string,
  codeVerifier: string,
): Promise<string | null> {
  const codeChallenge = await sha256Base64Url(codeVerifier)
  const [row] = await db
    .delete(authChallenge)
    .where(
      and(
        eq(authChallenge.purpose, DESKTOP_LINK_PURPOSE),
        eq(authChallenge.identifier, code),
        eq(authChallenge.challenge, codeChallenge),
        gt(authChallenge.expiresAt, new Date()),
      ),
    )
    .returning()
  if (!row) return null
  const userId = (row.payload as { userId?: unknown }).userId
  return typeof userId === "string" ? userId : null
}
