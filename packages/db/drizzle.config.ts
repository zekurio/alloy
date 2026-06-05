import { defineConfig } from "drizzle-kit"

const databaseUrl = process.env.DRIZZLE_DATABASE_URL ?? process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL or DRIZZLE_DATABASE_URL is required to run Drizzle CLI commands",
  )
}

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
})
