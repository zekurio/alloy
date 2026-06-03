import { Hono } from "hono"
import { stream } from "hono/streaming"

import {
  LOGIN_SPLASH_IMAGE_PATH,
  loginSplashImagePath,
  type PublicAuthConfig,
} from "@workspace/contracts"

import { env } from "../env"
import { configStore } from "../config/store"
import { getPublicProviders } from "../auth/oauth-config"
import { getSetupStatus } from "../auth/user-bootstrap"
import { notFound } from "../runtime/http-response"
import { pipeReadable } from "../runtime/streaming"
import { dataStorage } from "../storage"
import {
  LOGIN_SPLASH_CONTENT_TYPE,
  LOGIN_SPLASH_STORAGE_KEY,
} from "./admin-appearance"

const LEGACY_SPLASH_IMAGE_PATH = "/login-splash.jpg"

export const authConfigRoute = new Hono()
  .get("/", async (c) => {
    const setupStatus = await getSetupStatus()
    const loginSplash = configStore.get("appearance").loginSplash

    // No storage I/O on this hot path: trust the `enabled` flag and emit the
    // image URL. The splash-serving endpoint below 404s if the file is somehow
    // missing, and `ensureLoginSplashImage()` heals it at boot.
    return c.json(
      {
        ...setupStatus,
        openRegistrations: configStore.get("openRegistrations"),
        passkeyEnabled: configStore.get("passkeyEnabled"),
        requireAuthToBrowse: configStore.get("requireAuthToBrowse"),
        providers: getPublicProviders(),
        loginSplash: {
          enabled: loginSplash.enabled,
          blurPx: loginSplash.blurPx,
          darkenOpacity: loginSplash.darkenOpacity,
          imageUrl: loginSplash.enabled
            ? new URL(
              loginSplashImagePath(),
              env.PUBLIC_SERVER_URL,
            ).toString()
            : null,
        },
      } satisfies PublicAuthConfig,
    )
  })
  .get(LEGACY_SPLASH_IMAGE_PATH, (c) => {
    const url = new URL(c.req.url)
    url.pathname = LOGIN_SPLASH_IMAGE_PATH
    return c.redirect(url.toString(), 302)
  })
  .get(LOGIN_SPLASH_IMAGE_PATH.replace("/api/auth-config", ""), async (c) => {
    const loginSplash = configStore.get("appearance").loginSplash
    if (!loginSplash.enabled) return notFound(c)

    const resolved = await dataStorage.resolve(LOGIN_SPLASH_STORAGE_KEY)
    if (!resolved) return notFound(c)

    c.header("Content-Type", LOGIN_SPLASH_CONTENT_TYPE)
    c.header("Content-Length", String(resolved.size))
    c.header("Cache-Control", "public, no-cache")
    if (c.req.method === "HEAD") return c.body(null)
    return stream(c, async (s) => {
      await pipeReadable(s, resolved.stream())
    })
  })
