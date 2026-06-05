import { logger } from "@workspace/logging"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { createMiddleware } from "hono/factory"
import { logger as honoLogger } from "hono/logger"

import { getSession } from "./auth/session"
import { configStore } from "./config/store"
import { env } from "./env"
import { adminRoute } from "./routes/admin"
import { authRoute } from "./routes/auth"
import { authConfigRoute } from "./routes/auth-config"
import { csrf } from "./routes/auth-route-helpers"
import { clips } from "./routes/clips"
import { eventsRoute } from "./routes/events"
import { feedRoute } from "./routes/feed"
import { gamesRoute } from "./routes/games"
import { mlRoute } from "./routes/ml"
import { notificationsRoute } from "./routes/notifications"
import { searchRoute } from "./routes/search"
import { setupRoute } from "./routes/setup"
import { usersRoute } from "./routes/users"
import { userAssetsRoute, usersUploadRoute } from "./routes/users-upload"
import { internalServerError, unauthorized } from "./runtime/http-response"
import { storageRoute } from "./storage/fs-upload-route"
import { mountWeb } from "./web"

const BROWSE_API_PREFIXES = [
  "/api/clips",
  "/api/feed",
  "/api/games",
  "/api/search",
  "/api/users/search",
] as const

const BROWSE_API_PATTERNS = [/^\/api\/users\/(?!me(?:\/|$))[^/]+(?:\/.*)?$/]

const SHAREABLE_CLIP_ASSET_RE =
  /^\/api\/clips\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:stream|thumbnail|opengraph)$/i
const SHAREABLE_CLIP_HLS_RE =
  /^\/api\/clips\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/hls(?:\/.*)?$/i
const SHAREABLE_CLIP_DETAIL_RE =
  /^\/api\/clips\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHAREABLE_CLIP_COMMENTS_RE =
  /^\/api\/clips\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/comments$/i
const SHAREABLE_CLIP_VIEW_RE =
  /^\/api\/clips\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/view$/i

function isShareableClipRequest(method: string, path: string): boolean {
  if (SHAREABLE_CLIP_ASSET_RE.test(path) || SHAREABLE_CLIP_HLS_RE.test(path)) {
    return method === "GET" || method === "HEAD"
  }
  if (SHAREABLE_CLIP_DETAIL_RE.test(path)) return method === "GET"
  if (SHAREABLE_CLIP_COMMENTS_RE.test(path)) return method === "GET"
  if (SHAREABLE_CLIP_VIEW_RE.test(path)) return method === "POST"
  return false
}

const requireAuthToBrowse = createMiddleware(async (c, next) => {
  if (!configStore.get("requireAuthToBrowse")) {
    await next()
    return
  }

  const path = c.req.path
  if (isShareableClipRequest(c.req.method, path)) {
    await next()
    return
  }

  const isBrowseRequest =
    BROWSE_API_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    BROWSE_API_PATTERNS.some((pattern) => pattern.test(path))
  if (!isBrowseRequest) {
    await next()
    return
  }

  const session = await getSession(c)
  if (!session || session.user.status !== "active") {
    return unauthorized(c)
  }

  await next()
})

// Chain the route calls so the inferred type includes every route — the
// @workspace/api package consumes `AppType` via hono/client for RPC.
const apiApp = new Hono()
  .use(
    "*",
    honoLogger((line) => logger.info(line)),
  )
  .use(
    "*",
    cors({
      origin: env.TRUSTED_ORIGINS,
      credentials: true,
    }),
  )
  .use("/api/*", csrf)
  .use("/api/*", requireAuthToBrowse)
  // Secure-by-default: every API response is private and uncacheable unless the
  // handler explicitly sets its own Cache-Control (public clip media, games,
  // avatars). This makes leaking an authenticated response through a shared
  // cache impossible to do by omission — the failure mode that exposed config.
  .use("/api/*", async (c, next) => {
    await next()
    if (!c.res.headers.has("Cache-Control")) {
      c.header("Cache-Control", "private, no-store")
      c.header("Vary", "Cookie")
    }
  })
  .get("/health", (c) => c.json({ status: "ok" }))
  .route("/api/auth", authRoute)
  .route("/api/auth-config", authConfigRoute)
  .route("/api/setup", setupRoute)
  .route("/api/admin", adminRoute)
  .route("/api/clips", clips)
  .route("/api/feed", feedRoute)
  .route("/api/games", gamesRoute)
  .route("/api/ml", mlRoute)
  .route("/api/notifications", notificationsRoute)
  .route("/api/search", searchRoute)
  .route("/api/users", usersRoute)
  .route("/api/users", usersUploadRoute)
  .route("/api/events", eventsRoute)
  .route("/api/assets", storageRoute)
  .route("/api/assets/users", userAssetsRoute)
  .onError((err, c) => {
    logger.error("[api] unhandled request error:", err)

    return internalServerError(c)
  })

export const app = await mountWeb(apiApp)

export type AppType = typeof apiApp
