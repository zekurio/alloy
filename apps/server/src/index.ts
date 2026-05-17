import { migrateDatabase } from "@workspace/db"

import { app } from "./app"
import { env } from "./env"
import { startQueue, stopQueue } from "./queue"

const Deno = globalThis.Deno

if (env.NODE_ENV === "production") {
  await migrateDatabase(env.DATABASE_URL)
}

const server = Deno.serve(
  {
    port: env.PORT,
  },
  app.fetch
)

void startQueue().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[queue] failed to start:", err)
})

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  // eslint-disable-next-line no-console
  // Stop the queue first so in-flight encodes get a chance to finish
  // (or at least to flush their progress) before the HTTP server goes
  // away. The queue stop path waits for in-flight workers to clear.
  void stopQueue()
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[queue] failed to stop cleanly:", err)
    })
    .finally(() => {
      void server.shutdown().finally(() => Deno.exit(0))
    })
}

Deno.addSignalListener("SIGINT", shutdown)
Deno.addSignalListener("SIGTERM", shutdown)
