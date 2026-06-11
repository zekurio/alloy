import {
  createEnv,
  isLoopbackHostname,
  normalizeOrigin,
  normalizePublicServerUrl,
  postgresUrl,
} from "@alloy/env"
import { loadDotenv } from "@alloy/env/node"
import { z } from "zod"

// Deploy-time env only. Anything an admin should be able to change at
// runtime (OAuth provider, open-registrations) lives in `config/store.ts`.

// Fill in unset variables from the workspace `.env` (non-devenv local dev);
// real shell environment always wins. Production deployments (nix/docker set
// NODE_ENV in the wrapper) never probe the filesystem.
if (process.env.NODE_ENV !== "production") {
  loadDotenv()
}

function normalizeTrustedOrigins(value: string): string[] {
  const origins = new Set(
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map(normalizeOrigin),
  )
  origins.add(normalizeOrigin(defaultPublicServerUrl))
  return [...origins]
}

const defaultPublicServerUrl =
  process.env.PUBLIC_SERVER_URL ?? "http://localhost:2552"

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: postgresUrl(),
  PUBLIC_SERVER_URL: z
    .url()
    .default(defaultPublicServerUrl)
    .transform(normalizePublicServerUrl),
  PORT: z.coerce.number().int().positive().default(2552),
  // Packaging/deployment override for the packaged web app root. Local dev
  // usually serves the web app through Vite instead.
  WEB_DIST_DIR: z.string().optional(),
  TRUSTED_ORIGINS: z
    .string()
    .default(defaultPublicServerUrl)
    .transform(normalizeTrustedOrigins),

  // Bootstrap data: config.json and secrets.json live under this dir. Storage
  // locations are runtime config, not deploy-time env.
  ALLOY_DATA_DIR: z.string().optional(),
})

function readEnv(): z.infer<typeof EnvSchema> {
  const parsed = createEnv(EnvSchema, { label: "server/env" })

  if (
    parsed.NODE_ENV === "production" &&
    isLoopbackHostname(new URL(parsed.PUBLIC_SERVER_URL).hostname)
  ) {
    throw new Error(
      "[server/env] PUBLIC_SERVER_URL must be the externally reachable origin in production.",
    )
  }

  return parsed
}

export const env = readEnv()
