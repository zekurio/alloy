import { buildServerInfo } from "@alloy/server/server-info"
import { Hono } from "hono"

/** Public capability metadata. It contains no session-specific data. */
export const serverInfoRoute = new Hono().get("/", (c) => {
  c.header("Cache-Control", "private, no-store")
  return c.json(buildServerInfo())
})
