import { Hono } from "hono"

import type { PublicAuthConfig } from "@workspace/contracts"

import { configStore } from "../config/store"
import { getPublicProvider } from "../auth/oauth-config"
import { isSetupRequired } from "../auth/user-bootstrap"

export const authConfigRoute = new Hono().get("/", async (c) => {
  return c.json({
    setupRequired: await isSetupRequired(),
    openRegistrations: configStore.get("openRegistrations"),
    passkeyEnabled: configStore.get("passkeyEnabled"),
    requireAuthToBrowse: configStore.get("requireAuthToBrowse"),
    provider: getPublicProvider(),
  } satisfies PublicAuthConfig)
})
