import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"

import { getAuth } from "./auth"
import { env } from "./env"
import { adminRoute } from "./routes/admin"
import { authConfigRoute } from "./routes/auth-config"
import { clips } from "./routes/clips"
import { eventsRoute } from "./routes/events"
import { feedRoute } from "./routes/feed"
import { gamesRoute } from "./routes/games"
import { searchRoute } from "./routes/search"
import { setupRoute } from "./routes/setup"
import { usersRoute } from "./routes/users"
import { usersUploadRoute, userAssetsRoute } from "./routes/users-upload"
import { storageRoute } from "./storage/fs-upload-route"

// Chain the route calls so the inferred type includes every route — the
// @workspace/api package consumes `AppType` via hono/client for RPC.
export const app = new Hono()
  .use("*", logger())
  .use(
    "*",
    cors({
      origin: env.TRUSTED_ORIGINS,
      credentials: true,
    })
  )
  .get("/health", (c) => c.json({ status: "ok" }))
  // Resolve per-request so the admin UI can swap auth at runtime when the
  // OAuth provider changes.
  .on(["GET", "POST"], "/api/auth/*", (c) => getAuth().handler(c.req.raw))
  .route("/api/auth-config", authConfigRoute)
  .route("/api/setup", setupRoute)
  .route("/api/admin", adminRoute)
  .route("/api/clips", clips)
  .route("/api/feed", feedRoute)
  .route("/api/games", gamesRoute)
  .route("/api/search", searchRoute)
  .route("/api/users", usersRoute)
  .route("/api/users", usersUploadRoute)
  .route("/events", eventsRoute)
  // `/storage/upload/:token` is the fs driver's companion route — kept
  // out of `/api/*` because it has no analog under the s3 driver (the
  // browser would PUT straight at the bucket there).
  .route("/storage", storageRoute)
  .route("/storage/user-assets", userAssetsRoute)

export type AppType = typeof app
