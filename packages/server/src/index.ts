import { migrateDatabase } from "@alloy/db"
import { createLogger } from "@alloy/logging"
import { serve, type ServerType } from "@hono/node-server"

import {
  startAuthChallengeExpiryWorker,
  stopAuthChallengeExpiryWorker,
} from "./auth/challenge-expiry"
import { signInConfigError } from "./auth/sign-in-config"
import { configStore, initializeConfigStore } from "./config/store"
import { warmDatabase } from "./db"
import { env } from "./env"
import { startJobs, stopJobs } from "./jobs"
import { configureTranscode } from "./media/transcode-settings"
import {
  startNotificationExpiryWorker,
  stopNotificationExpiryWorker,
} from "./notifications/expiry"
import {
  startClipMediaWorker,
  stopClipMediaWorker,
} from "./queue/clip-media-worker"
import { requestShutdown } from "./runtime/shutdown"
import {
  startStorageDeletionWorker,
  stopStorageDeletionWorker,
} from "./storage/deletion-worker"
import { repairLegacyUploadDeadlines } from "./uploads/deadline"
import {
  startWebhookDeliveryWorker,
  stopWebhookDeliveryWorker,
} from "./webhooks/delivery-worker"

const logger = createLogger("server")

// Best-effort async work (SSE publishes, cache refreshes) must never take the
// process down; Node's default is --unhandled-rejections=throw.
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled promise rejection:", reason)
})

// Media modules default to a bare `ffmpeg`; apply env overrides before the
// worker can run any transcodes.
configureTranscode(env.transcode)

if (!env.steamgriddbApiKey) {
  logger.warn(
    "SteamGridDB game search is disabled because ALLOY_STEAMGRIDDB_API_KEY is not configured",
  )
}

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

try {
  // Older pending uploads did not own an absolute cleanup deadline. Repair
  // them in bounded statements before cleanup or HTTP can race the backfill.
  await repairLegacyUploadDeadlines(configStore.get("limits").uploadTtlSec)
  // Media requests are durable, but a server that accepts them without a live
  // worker is operationally unhealthy. Gate listen on recovery and generation
  // initialization so startup either succeeds completely or exits.
  await startClipMediaWorker()
  // Physical deletion is likewise durable. Probe the ledger before accepting
  // mutations so a missing migration cannot silently strand cleanup intents.
  await startStorageDeletionWorker()
  // Auth challenge TTLs use their own indexed deadline coordinator rather
  // than manufacturing recurring generic jobs.
  startAuthChallengeExpiryWorker()
  // Notification retention has different read/unread deadlines. Start its
  // indexed coordinator before accepting notification mutations.
  startNotificationExpiryWorker()
} catch (err) {
  logger.error("failed to start durable background workers:", err)
  process.exit(1)
}

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

void startJobs().catch((err) => {
  logger.error("failed to start jobs:", err)
})
startWebhookDeliveryWorker()

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  requestShutdown()
  const forceShutdown = setTimeout(() => {
    logger.warn("forcing shutdown after graceful deadline")
    closeAllConnections(server)
    process.exit(0)
  }, SHUTDOWN_GRACE_MS)

  // Stop background work before the HTTP server goes away so in-flight media
  // runs get a chance to flush state.
  void Promise.all([
    stopClipMediaWorker(),
    stopStorageDeletionWorker(),
    stopAuthChallengeExpiryWorker(),
    stopNotificationExpiryWorker(),
    stopWebhookDeliveryWorker(),
    stopJobs(),
  ])
    .catch((err) => {
      logger.error("failed to stop background workers cleanly:", err)
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

interface ConnectionClosingServer {
  closeAllConnections(): void
}

function closeAllConnections(server: ServerType): void {
  if (supportsConnectionClose(server)) server.closeAllConnections()
}

function supportsConnectionClose(
  server: ServerType,
): server is ServerType & ConnectionClosingServer {
  return "closeAllConnections" in server
}
