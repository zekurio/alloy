import { serve } from "@hono/node-server"
import { migrateDatabase } from "@workspace/db"
import { logger } from "@workspace/logging"

import { app } from "./app"
import { startChallengeSweeper, stopChallengeSweeper } from "./auth/webauthn"
import { warmDatabase } from "./db"
import { env } from "./env"
import { startQueue, stopQueue } from "./queue"
import { ensureLoginSplashImage } from "./routes/admin-appearance"
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
