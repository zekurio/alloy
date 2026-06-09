import { serve } from "@hono/node-server"
import { migrateDatabase } from "alloy-db"
import { logger } from "alloy-logging"

import { app } from "./app"
import { startChallengeSweeper, stopChallengeSweeper } from "./auth/webauthn"
import { startLiveHlsCache, stopLiveHlsCache } from "./clips/live-hls-cache"
import { warmDatabase } from "./db"
import { env } from "./env"
import { startQueue, stopQueue } from "./queue"
import { ensureLoginSplashImage } from "./routes/admin-appearance"
import { warmEncoderCapabilities } from "./routes/admin-encoder-capabilities"
import { requestShutdown } from "./runtime/shutdown"
import { startScheduledTasks, stopScheduledTasks } from "./scheduled-tasks"

if (env.NODE_ENV === "production") {
  await migrateDatabase(env.DATABASE_URL)
}

try {
  await warmDatabase()
} catch (err) {
  logger.error("[db] failed to warm database connection:", err)
  process.exit(1)
}

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  ({ address, port }) => {
    logger.info(`[server] listening on ${address}:${port}`)
  },
)

const SHUTDOWN_GRACE_MS = 5000

void startQueue().catch((err) => {
  logger.error("[queue] failed to start:", err)
})

void startLiveHlsCache().catch((err) => {
  logger.error("[clips] failed to start live HLS cache:", err)
})

startScheduledTasks()

// Probe encoder capabilities up front so the first stream request doesn't wait
// on the multi-second encoder smoke tests (slowest path: live AV1 selection).
warmEncoderCapabilities()

// Background TTL cleanup for auth challenges, kept off the request path.
startChallengeSweeper()

// Heal the login splash image if it is enabled but missing from storage (e.g.
// after upgrading from the pre-v2 config that generated it on demand). Runs
// off the request path; admins can still regenerate manually if this fails.
void ensureLoginSplashImage().catch((err) => {
  logger.error("[admin-appearance] failed to ensure login splash image:", err)
})

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  requestShutdown()
  stopChallengeSweeper()
  void stopLiveHlsCache()
  const forceShutdown = setTimeout(() => {
    logger.warn("[server] forcing shutdown after graceful deadline")
    closeAllConnections(server)
    process.exit(0)
  }, SHUTDOWN_GRACE_MS)

  // Stop background work before the HTTP server goes away so in-flight media
  // jobs and scheduled tasks get a chance to flush state.
  void Promise.allSettled([stopScheduledTasks(), stopQueue()])
    .then((results) => {
      const [scheduledResult, queueResult] = results
      if (scheduledResult?.status === "rejected") {
        logger.error(
          "[scheduled-tasks] failed to stop cleanly:",
          scheduledResult.reason,
        )
      }
      if (queueResult?.status === "rejected") {
        logger.error("[queue] failed to stop cleanly:", queueResult.reason)
      }
    })
    .finally(() => {
      server.close(() => {
        clearTimeout(forceShutdown)
        process.exit(0)
      })
    })
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

function closeAllConnections(value: unknown) {
  const candidate = value as { closeAllConnections?: unknown }
  if (typeof candidate.closeAllConnections === "function") {
    candidate.closeAllConnections()
  }
}
