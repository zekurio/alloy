import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { createEnv, postgresUrl } from "@alloy/env"
import { loadDotenv } from "@alloy/env/node"
import { defineConfig } from "drizzle-kit"
import { Type } from "typebox"

const packageDir = dirname(fileURLToPath(import.meta.url))

// Fill in unset variables from the nearest local development `.env`, the
// repository root's unless the db package has its own.
loadDotenv(packageDir)

const env = createEnv(
  Type.Object({
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
