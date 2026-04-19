import { serve } from "@hono/node-server"

import { app } from "./app"
import { env } from "./env"
import { startQueue, stopQueue } from "./queue"

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    // eslint-disable-next-line no-console
    console.log(`→ api listening on http://localhost:${info.port}`)
  }
)

// Bring the queue up *after* the HTTP server is bound. If pg-boss can't
// reach Postgres we still want `/health` to answer (the queue logs its
// own error and the reaper retry will eventually catch up); a hard
// startup failure here would leave the API dark for a transient DB blip.
void startQueue().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[queue] failed to start:", err)
})

let shuttingDown = false
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return
  shuttingDown = true
  // eslint-disable-next-line no-console
  console.log(`→ ${signal} received, draining…`)
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
