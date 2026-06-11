import { defineConfig } from "drizzle-kit"

const databaseUrl =
  process.env.DRIZZLE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/alloy"

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
})
