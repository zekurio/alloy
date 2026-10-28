import { migrateDatabase } from "@alloy/db"
import { createLogger } from "@alloy/logging"
import { serve, type ServerType } from "@hono/node-server"

import {
  startAuthChallengeExpiryWorker,
  stopAuthChallengeExpiryWorker,
} from "./auth/challenge-expiry"
import {
  startAuthSessionExpiryWorker,
  stopAuthSessionExpiryWorker,
} from "./auth/session-expiry"
import { currentSignInConfig, signInConfigError } from "./auth/sign-in-config"
import { configStore, initializeConfigStore } from "./config/store"
import { warmDatabase } from "./db"
import { env } from "./env"
import { KILL_GRACE_MS } from "./media/run-process"
import { configureTranscode } from "./media/transcode-settings"
import {
  startClipMediaWorker,
  stopClipMediaWorker,
} from "./queue/clip-media-worker"
import { clearMediaWorkDirs } from "./queue/media-run-helpers"
import { requestShutdown } from "./runtime/shutdown"
import {
  startStorageDeletionWorker,
  stopStorageDeletionWorker,
} from "./storage/deletion-worker"
import {
  startUploadExpiryWorker,
  stopUploadExpiryWorker,
} from "./uploads/expiry"
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
  const authError = await signInConfigError(currentSignInConfig())
  if (authError) {
    logger.error(`unsafe sign-in configuration: ${authError}`)
    process.exit(1)
  }
}

const { app } = await import("./app")

try {
  // Work dirs belong to runs of this process; a killed process strands its
  // sources and partial renditions there.
  await clearMediaWorkDirs()
} catch (err) {
  logger.warn("failed to clear media scratch from an earlier run:", err)
}

try {
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
  // Expired sessions are already ignored by lookups; this only prunes them.
  startAuthSessionExpiryWorker()
  // Pending clip uploads and detached ticket owners share one globally ordered
  // deadline coordinator. Pending clips retain exact-object crash recovery.
  startUploadExpiryWorker()
  startWebhookDeliveryWorker()
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

// A stopping media run first waits up to the kill grace for ffmpeg to exit,
// then records which of its objects to delete; exiting sooner strands them.
const SHUTDOWN_GRACE_MS = KILL_GRACE_MS + 10_000

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
    stopAuthSessionExpiryWorker(),
    stopUploadExpiryWorker(),
    stopWebhookDeliveryWorker(),
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
