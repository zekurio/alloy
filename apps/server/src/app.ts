import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"

import { getAuth } from "./auth"
import { env } from "./env"
import { adminRoute } from "./routes/admin"
import { authConfigRoute } from "./routes/auth-config"
import { clips } from "./routes/clips"
import { setupRoute } from "./routes/setup"

// Chain the route calls so the inferred type includes every route — the
// @workspace/api package consumes `AppType` via hono/client for RPC.
export const app = new Hono()
  .use("*", logger())
  .use(
    "*",
    cors({
      origin: env.TRUSTED_ORIGINS,
      credentials: true,
    }),
  )
  .get("/health", (c) => c.json({ status: "ok" }))
  // Resolve per-request so the admin UI can swap auth at runtime when the
  // OAuth provider changes.
  .on(["GET", "POST"], "/api/auth/*", (c) => getAuth().handler(c.req.raw))
  .route("/api/auth-config", authConfigRoute)
  .route("/api/setup", setupRoute)
  .route("/api/admin", adminRoute)
  .route("/api/clips", clips)

export type AppType = typeof app
