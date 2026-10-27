import { t } from "@alloy/contracts/schema"
import { translate } from "@alloy/i18n"
import { SESSION_COOKIE_MAX_AGE_SEC } from "@alloy/server/auth/cookies"
import {
  consumeDesktopLinkCode,
  createDesktopLinkCode,
} from "@alloy/server/auth/desktop-link"
import {
  createSession,
  getSession,
  InactiveAccountError,
} from "@alloy/server/auth/session"
import { getSetupStatus } from "@alloy/server/auth/user-bootstrap"
import { badRequest, forbidden } from "@alloy/server/runtime/http-response"
import { requestLocale } from "@alloy/server/runtime/request-locale"
import { type Context, Hono } from "hono"

import {
  desktopAuthorizeWebUrl,
  loopbackRedirect,
  normalizeDeviceName,
} from "./auth-desktop-helpers"
import { tbValidator } from "./validation"

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/

function requiredFormString(
  body: Record<string, string | File>,
  key: string,
): string | null {
  const value = body[key]
  return value && !(value instanceof File) ? value : null
}

async function redirectToSetupIfRequired(c: Context): Promise<Response | null> {
  const setup = await getSetupStatus()
  return setup.setupRequired ? c.redirect("/setup", 302) : null
}

const CodeChallenge = t.string().min(32).max(128).regex(BASE64URL_RE)
const TokenBody = t.object({
  code: t.string().min(1),
  codeVerifier: t.string().min(32).max(128).regex(BASE64URL_RE),
  // Absent when the app cannot read the computer name.
  deviceName: t.string().max(256).optional(),
})

export const authDesktopRoute = new Hono()
  // Browser entry point. The desktop app opens this in the system browser and
  // the confirmation UI lives in the web app, which shares the auth frame,
  // styles, and full passkey/OAuth support. Minting the one-time code for the
  // app's loopback listener stays here.
  .get("/authorize", async (c) => {
    const locale = requestLocale(c)
    const redirect = loopbackRedirect(c.req.query("redirect_uri"))
    const state = c.req.query("state")
    const codeChallenge = CodeChallenge.safeParse(c.req.query("code_challenge"))
    if (!redirect || !state || !codeChallenge.success) {
      return c.text(translate(locale, "Invalid desktop login request."), 400)
    }

    const setupRedirect = await redirectToSetupIfRequired(c)
    if (setupRedirect) return setupRedirect

    return c.redirect(
      desktopAuthorizeWebUrl(redirect.toString(), state, codeChallenge.data),
      302,
    )
  })
  .post("/authorize", async (c) => {
    const locale = requestLocale(c)
    // A malformed multipart body fails like a missing field, not a 500.
    const body = await c.req
      .parseBody()
      .catch((): Record<string, string | File> => ({}))
    const redirect = loopbackRedirect(requiredFormString(body, "redirect_uri"))
    const state = requiredFormString(body, "state")
    const codeChallenge = CodeChallenge.safeParse(
      requiredFormString(body, "code_challenge"),
    )
    if (!redirect || !state || !codeChallenge.success) {
      return c.text(translate(locale, "Invalid desktop login request."), 400)
    }

    const setupRedirect = await redirectToSetupIfRequired(c)
    if (setupRedirect) return setupRedirect

    const session = await getSession(c)
    if (!session || session.user.status !== "active") {
      // Session lapsed after the confirmation page rendered: send them back
      // through the web UI, returning here once a session exists.
      return c.redirect(
        `/login?redirect=${encodeURIComponent(
          desktopAuthorizeWebUrl(
            redirect.toString(),
            state,
            codeChallenge.data,
          ),
        )}`,
        302,
      )
    }

    const code = await createDesktopLinkCode(
      session.user.id,
      codeChallenge.data,
    )
    redirect.searchParams.set("code", code)
    redirect.searchParams.set("state", state)
    // Language hint for the desktop app's loopback result page, which has no
    // access to the web i18n catalog.
    redirect.searchParams.set("locale", locale)
    return c.redirect(redirect.toString(), 302)
  })
  // Code exchange, called server-to-server by the desktop app (no cookies).
  // Mints a fresh session distinct from the browser's, so signing out of one
  // doesn't kill the other.
  .post("/token", tbValidator("json", TokenBody), async (c) => {
    const { code, codeVerifier, deviceName } = c.req.valid("json")
    const userId = await consumeDesktopLinkCode(code, codeVerifier)
    if (!userId) return badRequest(c, "Invalid or expired code.")

    const created = await createSession(c, userId, {
      kind: "desktop",
      deviceName: normalizeDeviceName(deviceName),
    }).catch((cause: unknown) => {
      if (cause instanceof InactiveAccountError) return null
      throw cause
    })
    if (!created) return forbidden(c, "Account is not active.")

    // The app injects the token as its bootstrap cookie with this expiry,
    // matching the cookie the server sets itself.
    const cookieExpiresAt = new Date(
      Date.now() + SESSION_COOKIE_MAX_AGE_SEC * 1000,
    ).toISOString()
    return c.json({ sessionToken: created.token, cookieExpiresAt })
  })
