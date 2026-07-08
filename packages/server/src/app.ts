import { createLogger, getLogContext, runWithLogContext } from "@alloy/logging"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { createMiddleware } from "hono/factory"
import { NONCE, secureHeaders } from "hono/secure-headers"

import { getSession } from "./auth/session"
import { configStore } from "./config/store"
import { env } from "./env"
import { adminRoute } from "./routes/admin"
import { gameAssetsRoute } from "./routes/admin-games"
import { authRoute } from "./routes/auth"
import { authConfigRoute } from "./routes/auth-config"
import { csrf } from "./routes/auth-route-helpers"
import { clips } from "./routes/clips"
import { eventsRoute } from "./routes/events"
import { feedRoute } from "./routes/feed"
import { gamesRoute } from "./routes/games"
import { notificationsRoute } from "./routes/notifications"
import { searchRoute } from "./routes/search"
import { setupRoute } from "./routes/setup"
import { tagsRoute } from "./routes/tags"
import { usersRoute } from "./routes/users"
import { userAssetsRoute, usersUploadRoute } from "./routes/users-upload"
import { internalServerError, unauthorized } from "./runtime/http-response"
import { storageRoute } from "./storage/fs-upload-route"
import { mountWeb } from "./web"

const requestLogger = createLogger("http")
const logger = createLogger("api")

const BROWSE_API_PREFIXES = [
  "/api/clips",
  "/api/feed",
  "/api/games",
  "/api/search",
  "/api/users/search",
] as const

const BROWSE_API_PATTERNS = [/^\/api\/users\/(?!me(?:\/|$))[^/]+(?:\/.*)?$/]

const SHAREABLE_CLIP_ASSET_RE =
  /^\/api\/clips\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:stream|thumbnail)$/i
const SHAREABLE_CLIP_DETAIL_RE =
  /^\/api\/clips\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHAREABLE_CLIP_COMMENTS_RE =
  /^\/api\/clips\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/comments$/i
const SHAREABLE_CLIP_VIEW_RE =
  /^\/api\/clips\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/view$/i
const REQUEST_ID_RE = /^[\w-]{1,64}$/

function requestIdForHeader(value: string | undefined): string {
  if (value && REQUEST_ID_RE.test(value)) return value
  return crypto.randomUUID().slice(0, 8)
}

function isShareableClipRequest(method: string, path: string): boolean {
  if (SHAREABLE_CLIP_ASSET_RE.test(path)) {
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

const requestCorrelation = createMiddleware(async (c, next) => {
  const requestId = requestIdForHeader(c.req.header("X-Request-Id"))
  const startedAt = performance.now()
  c.header("X-Request-Id", requestId)

  await runWithLogContext({ req: requestId }, async () => {
    let didThrow = false
    try {
      await next()
    } catch (err) {
      didThrow = true
      throw err
    } finally {
      const durationMs = Math.round(performance.now() - startedAt)
      const status = didThrow ? 500 : c.res.status
      requestLogger.info(
        `${c.req.method} ${c.req.path} ${status} ${durationMs}ms`,
      )
    }
  })
})

// Chain the route calls so the inferred type includes every route — the
// @alloy/api package consumes `AppType` via hono/client for RPC.
const apiApp = new Hono()
  .use("*", requestCorrelation)
  .use(
    "*",
    cors({
      origin: env.TRUSTED_ORIGINS,
      credentials: true,
    }),
  )
  .use(
    "*",
    secureHeaders({
      // TLS/HSTS is the reverse proxy's job; COOP/CORP/OAC stay off so OAuth
      // popups and cross-origin media embeds keep working.
      strictTransportSecurity: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      originAgentCluster: false,
      // Not the hono default ("no-referrer"): the Fetch spec applies the
      // referrer policy to the Origin header too, so under no-referrer
      // browsers send `Origin: null` even on same-origin POSTs — which the
      // csrf middleware would reject. "same-origin" keeps Origin intact for
      // same-origin requests while still hiding the referrer cross-origin.
      referrerPolicy: "same-origin",
      // Report-only first; rename this key to `contentSecurityPolicy` to
      // enforce after production reports confirm the policy is quiet.
      contentSecurityPolicyReportOnly: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", NONCE],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Storage is filesystem-only today, so browser media URLs stay
        // same-origin. Future direct-storage URLs need their origin here.
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        frameAncestors: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
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
  .route("/api/search", searchRoute)
  .route("/api/tags", tagsRoute)
  .route("/api/users", usersRoute)
  .route("/api/users", usersUploadRoute)
  .route("/api/notifications", notificationsRoute)
  .route("/api/events", eventsRoute)
  .route("/api/assets", storageRoute)
  .route("/api/assets/users", userAssetsRoute)
  .route("/api/assets/games", gameAssetsRoute)
  .onError((err, c) => {
    const requestId =
      getLogContext().req ?? c.res.headers.get("X-Request-Id") ?? undefined
    runWithLogContext(requestId ? { req: requestId } : {}, () => {
      logger.error("unhandled request error:", err)
    })
    return internalServerError(
      c,
      requestId
        ? `Internal Server Error (request ${requestId})`
        : "Internal Server Error",
    )
  })

export const app = await mountWeb(apiApp)

export type AppType = typeof apiApp
