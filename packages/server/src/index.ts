import { migrateDatabase } from "@alloy/db"
import { logger } from "@alloy/logging"
import { serve } from "@hono/node-server"

import { app } from "./app"
import { startChallengeSweeper, stopChallengeSweeper } from "./auth/webauthn"
import { startDirectHlsCache, stopDirectHlsCache } from "./clips/direct-hls"
import { warmDatabase } from "./db"
import { env } from "./env"
import { startQueue, stopQueue } from "./queue"
import { requestShutdown } from "./runtime/shutdown"

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

void startDirectHlsCache().catch((err) => {
  logger.error("[clips] failed to start direct HLS cache:", err)
})

// Background TTL cleanup for auth challenges, kept off the request path.
startChallengeSweeper()

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  requestShutdown()
  stopChallengeSweeper()
  void stopDirectHlsCache()
  const forceShutdown = setTimeout(() => {
    logger.warn("[server] forcing shutdown after graceful deadline")
    closeAllConnections(server)
    process.exit(0)
  }, SHUTDOWN_GRACE_MS)

  // Stop background work before the HTTP server goes away so in-flight media
  // jobs get a chance to flush state.
  void stopQueue()
    .catch((err) => {
      logger.error("[queue] failed to stop cleanly:", err)
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
