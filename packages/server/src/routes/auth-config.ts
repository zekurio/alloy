import { LOGIN_SPLASH_IMAGE_PATH } from "alloy-contracts"
import { Hono } from "hono"
import { stream } from "hono/streaming"

import { buildPublicAuthConfig } from "../auth/public-config"
import { configStore } from "../config/store"
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
    return c.json(await buildPublicAuthConfig())
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
