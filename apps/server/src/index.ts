import { serve } from "@hono/node-server"

import { app } from "./app"
import { env } from "./env"

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    // eslint-disable-next-line no-console
    console.log(`→ api listening on http://localhost:${info.port}`)
  },
)

const shutdown = () => {
  server.close(() => process.exit(0))
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
