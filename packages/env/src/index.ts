import { z } from "zod"

/**
 * Parse environment variables against a zod schema, throwing a readable
 * error listing every invalid field. `label` identifies the consumer in the
 * error message (e.g. "server/env").
 */
export function createEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  options: {
    label: string
    /** Defaults to `process.env`. */
    source?: Record<string, string | undefined>
  },
): z.output<TSchema> {
  const parsed = schema.safeParse(options.source ?? process.env)
  if (!parsed.success) {
    throw new Error(
      `[${options.label}] Invalid environment variables:\n` +
        JSON.stringify(z.flattenError(parsed.error).fieldErrors, null, 2),
    )
  }
  return parsed.data
}

/** Zod schema for a postgres:// or postgresql:// connection URL. */
export function postgresUrl() {
  return z
    .string()
    .min(1)
    .refine(isPostgresUrl, "Expected a postgres:// or postgresql:// URL")
}

export function isPostgresUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === "postgres:" || protocol === "postgresql:"
  } catch {
    return false
  }
}

export function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Normalize a public server URL: drop a trailing `/api` path segment, query,
 * hash, and trailing slash so the result is a stable origin-ish base URL.
 */
export function normalizePublicServerUrl(value: string): string {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/api\/?$/, "") || "/"
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

/** Reduce a URL to its bare origin (no path, query, or hash). */
export function normalizeOrigin(value: string): string {
  const url = new URL(value)
  url.pathname = ""
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    isLoopbackIpv4(hostname) ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  )
}

function isLoopbackIpv4(hostname: string): boolean {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts[0] !== "127") return false
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}
