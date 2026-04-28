import { Hono } from "hono"

import { isSetupRequired } from "../auth/user-bootstrap"

export const setupRoute = new Hono().get("/status", async (c) => {
  return c.json({ setupRequired: await isSetupRequired() })
})
