import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { createEnv, postgresUrl } from "@alloy/env"
import { loadDotenv } from "@alloy/env/node"
import { defineConfig } from "drizzle-kit"
import { z } from "zod"

const packageDir = dirname(fileURLToPath(import.meta.url))

// Fill in unset variables from local development `.env` files. Drizzle runs in
// the db package, but DATABASE_URL is shared with the server package.
loadDotenv(packageDir)
loadDotenv(join(packageDir, "..", "server"))

const env = createEnv(
  z.object({
    DATABASE_URL: postgresUrl(),
  }),
  { label: "db/drizzle" },
)

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/schema/index.ts", "./src/schema/auth.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
})
