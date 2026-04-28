import { Hono } from "hono"

import type { PublicAuthConfig } from "@workspace/contracts"

import { configStore } from "../config/store"
import { getPublicProvider } from "../auth/oauth-config"
import { getSetupStatus } from "../auth/user-bootstrap"

export const authConfigRoute = new Hono().get("/", async (c) => {
  const setupStatus = await getSetupStatus()
  return c.json({
    ...setupStatus,
    openRegistrations: configStore.get("openRegistrations"),
    passkeyEnabled: configStore.get("passkeyEnabled"),
    requireAuthToBrowse: configStore.get("requireAuthToBrowse"),
    provider: getPublicProvider(),
  } satisfies PublicAuthConfig)
})
