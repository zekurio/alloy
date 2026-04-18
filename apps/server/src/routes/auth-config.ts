import { Hono } from "hono"

import { configStore } from "../lib/config-store"
import { getPublicProvider } from "../lib/oauth-config"
import { isSetupRequired } from "../lib/user-bootstrap"

/**
 * Public config consumed by the login + setup pages. Narrow by design —
 * reachable without a session, so nothing sensitive.
 */
export const authConfigRoute = new Hono().get("/", async (c) => {
  return c.json({
    setupRequired: await isSetupRequired(),
    openRegistrations: configStore.get("openRegistrations"),
    provider: getPublicProvider(),
  })
})
