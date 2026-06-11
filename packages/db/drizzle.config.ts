import { createEnv, postgresUrl } from "alloy-env"
import { defineConfig } from "drizzle-kit"
import { z } from "zod"

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
