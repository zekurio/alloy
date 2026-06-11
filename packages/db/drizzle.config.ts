import { createEnv, postgresUrl } from "alloy-env"
import { loadDotenv } from "alloy-env/node"
import { defineConfig } from "drizzle-kit"
import { z } from "zod"

// Fill in unset variables from the workspace `.env` (non-devenv local dev);
// real shell environment always wins.
loadDotenv()

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
