import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"

import { env } from "./env"
import { adminRoute } from "./routes/admin"
import { authRoute } from "./routes/auth"
import { authConfigRoute } from "./routes/auth-config"
import { clips } from "./routes/clips"
import { eventsRoute } from "./routes/events"
import { feedRoute } from "./routes/feed"
import { gamesRoute } from "./routes/games"
import { notificationsRoute } from "./routes/notifications"
import { searchRoute } from "./routes/search"
import { setupRoute } from "./routes/setup"
import { usersRoute } from "./routes/users"
import { usersUploadRoute, userAssetsRoute } from "./routes/users-upload"
import { storageRoute } from "./storage/fs-upload-route"
import { mountWeb } from "./web"

// Chain the route calls so the inferred type includes every route — the
// @workspace/api package consumes `AppType` via hono/client for RPC.
const apiApp = new Hono()
  .use("*", logger())
  .use(
    "*",
    cors({
      origin: env.TRUSTED_ORIGINS,
      credentials: true,
    })
  )
  .get("/health", (c) => c.json({ status: "ok" }))
  .route("/api/auth", authRoute)
  .route("/api/auth-config", authConfigRoute)
  .route("/api/setup", setupRoute)
  .route("/api/admin", adminRoute)
  .route("/api/clips", clips)
  .route("/api/feed", feedRoute)
  .route("/api/games", gamesRoute)
  .route("/api/notifications", notificationsRoute)
  .route("/api/search", searchRoute)
  .route("/api/users", usersRoute)
  .route("/api/users", usersUploadRoute)
  .route("/api/events", eventsRoute)
  .route("/api/assets", storageRoute)
  .route("/api/assets/users", userAssetsRoute)

export const app = await mountWeb(apiApp)

export type AppType = typeof apiApp
