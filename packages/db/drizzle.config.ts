import { defineConfig } from "drizzle-kit"

const databaseUrl = Deno.env.get("DRIZZLE_DATABASE_URL") ??
  Deno.env.get("DATABASE_URL")

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
