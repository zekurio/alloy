import { migrateDatabase } from "@alloy/db"
import { createLogger } from "@alloy/logging"
import { serve } from "@hono/node-server"

import { signInConfigError } from "./auth/sign-in-config"
import { startChallengeSweeper, stopChallengeSweeper } from "./auth/webauthn"
import { configStore, initializeConfigStore } from "./config/store"
import { warmDatabase } from "./db"
import { env } from "./env"
import { startQueue, stopQueue } from "./queue"
import { requestShutdown } from "./runtime/shutdown"

const logger = createLogger("server")

// Best-effort async work (SSE publishes, cache refreshes) must never take the
// process down; Node's default is --unhandled-rejections=throw.
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled promise rejection:", reason)
})

if (env.NODE_ENV === "production") {
  await migrateDatabase(env.DATABASE_URL)
}

try {
  await warmDatabase()
  await initializeConfigStore()
} catch (err) {
  logger.error("failed to warm database connection:", err)
  process.exit(1)
}

if (configStore.get("setupComplete")) {
  const authError = await signInConfigError(configStore.getAll())
  if (authError) {
    logger.error(`unsafe sign-in configuration: ${authError}`)
    process.exit(1)
  }
}

const { app } = await import("./app")

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  ({ address, port }) => {
    logger.info(`listening on ${address}:${port}`)
  },
)

const SHUTDOWN_GRACE_MS = 5000

void startQueue().catch((err) => {
  logger.error("failed to start queue:", err)
})

// Background TTL cleanup for auth challenges, kept off the request path.
startChallengeSweeper()

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  requestShutdown()
  stopChallengeSweeper()
  const forceShutdown = setTimeout(() => {
    logger.warn("forcing shutdown after graceful deadline")
    closeAllConnections(server)
    process.exit(0)
  }, SHUTDOWN_GRACE_MS)

  // Stop background work before the HTTP server goes away so in-flight media
  // jobs get a chance to flush state.
  void stopQueue()
    .catch((err) => {
      logger.error("failed to stop queue cleanly:", err)
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
