import { buildPublicAuthConfig } from "@alloy/server/auth/public-config"
import { configStore } from "@alloy/server/config/store"
import { Hono } from "hono"

import { getLoginBackdropClipIds } from "./admin-appearance"

export const authConfigRoute = new Hono()
  .get("/", async (c) => {
    return c.json(await buildPublicAuthConfig())
  })
  .get("/backdrops", async (c) => {
    // Random per request — never cache. Empty when the backdrop is disabled so
    // the login page simply shows the plain background.
    c.header("Cache-Control", "no-store")
    const enabled = configStore.get("appearance").loginSplash.enabled
    const clipIds = enabled ? await getLoginBackdropClipIds() : []
    return c.json({ clipIds })
  })
