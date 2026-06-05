import { serve } from "@hono/node-server"
import { migrateDatabase } from "@workspace/db"
import { logger } from "@workspace/logging"

import { app } from "./app"
import { startChallengeSweeper, stopChallengeSweeper } from "./auth/webauthn"
import { startLiveHlsCache, stopLiveHlsCache } from "./clips/live-hls-cache"
import { warmDatabase } from "./db"
import { env } from "./env"
import { startQueue, stopQueue } from "./queue"
import { ensureLoginSplashImage } from "./routes/admin-appearance"
import { warmEncoderCapabilities } from "./routes/admin-encoder-capabilities"
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

void startQueue().catch((err) => {
  logger.error("[queue] failed to start:", err)
})

void startLiveHlsCache().catch((err) => {
  logger.error("[clips] failed to start live HLS cache:", err)
})

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
  // Stop the queue first so in-flight encodes get a chance to finish
  // (or at least to flush their progress) before the HTTP server goes
  // away. The queue stop path waits for in-flight workers to clear.
  void stopQueue()
    .catch((err) => {
      logger.error("[queue] failed to stop cleanly:", err)
    })
    .finally(() => {
      server.close(() => process.exit(0))
    })
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
