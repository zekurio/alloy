import { config } from "dotenv"
import { defineConfig } from "drizzle-kit"
import process from "node:process"

config({
  path: new URL("../../apps/server/.env.example", import.meta.url).pathname,
})
config({
  path: new URL("../../apps/server/.env", import.meta.url).pathname,
  override: true,
})

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
})
