import { getSetupStatus } from "@alloy/server/auth/user-bootstrap"
import { Hono } from "hono"

export const setupRoute = new Hono().get("/status", async (c) => {
  return c.json(await getSetupStatus())
})
