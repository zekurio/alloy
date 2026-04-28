import { Hono } from "hono"

import { getSetupStatus } from "../auth/user-bootstrap"

export const setupRoute = new Hono().get("/status", async (c) => {
  return c.json(await getSetupStatus())
})
