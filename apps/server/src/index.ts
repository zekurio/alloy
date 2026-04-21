import { serve } from "@hono/node-server"

import { app } from "./app"
import { env } from "./env"
import { startQueue, stopQueue } from "./queue"

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (_info) => {
    // eslint-disable-next-line no-console
  }
)

void startQueue().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[queue] failed to start:", err)
})

let shuttingDown = false
const shutdown = (_signal: NodeJS.Signals) => {
  if (shuttingDown) return
  shuttingDown = true
  // eslint-disable-next-line no-console
  // Stop the queue first so in-flight encodes get a chance to finish
  // (or at least to flush their progress) before the HTTP server goes
  // away. pg-boss's graceful stop waits for the workers to clear.
  void stopQueue()
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[queue] failed to stop cleanly:", err)
    })
    .finally(() => {
      server.close(() => process.exit(0))
    })
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
