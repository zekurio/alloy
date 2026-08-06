import { Type } from "typebox"
import type { StaticDecode, TSchema } from "typebox"
import { Decode, Errors } from "typebox/value"

/**
 * Parse environment variables against a TypeBox schema, throwing a readable
 * error listing every invalid field. `label` identifies the consumer in the
 * error message (e.g. "server/env").
 */
export function createEnv<Schema extends TSchema>(
  schema: Schema,
  options: {
    label: string
    /** Defaults to `process.env`. */
    source?: Record<string, string | undefined>
  },
): StaticDecode<Schema> {
  const source = { ...(options.source ?? process.env) }
  try {
    return Decode(schema, source)
  } catch (cause) {
    throw new Error(
      `[${options.label}] Invalid environment variables:\n` +
        JSON.stringify(groupErrors(schema, source, cause), null, 2),
      { cause },
    )
  }
}

function groupErrors(schema: TSchema, value: unknown, cause: unknown) {
  return (decodeErrors(cause) ?? [...Errors(schema, value)]).reduce<
    Record<string, string[]>
  >((groups, error) => {
    const key = error.instancePath.split("/")[1] ?? ""
    groups[key] = [...(groups[key] ?? []), error.message]
    return groups
  }, {})
}

function decodeErrors(cause: unknown) {
  if (!cause || typeof cause !== "object" || !("cause" in cause)) return null
  const details = cause.cause
  if (!details || typeof details !== "object" || !("errors" in details)) {
    return null
  }
  if (!Array.isArray(details.errors)) return null
  const errors = details.errors.filter(
    (error): error is { instancePath: string; message: string } =>
      typeof error === "object" &&
      error !== null &&
      "instancePath" in error &&
      typeof error.instancePath === "string" &&
      "message" in error &&
      typeof error.message === "string",
  )
  return errors.length > 0 ? errors : null
}

/** TypeBox schema for a postgres:// or postgresql:// connection URL. */
export function postgresUrl() {
  return Type.Refine(
    Type.String({ minLength: 1 }),
    isPostgresUrl,
    () => "Expected a postgres:// or postgresql:// URL",
  )
}

export function isPostgresUrl(value: string): boolean {
  if (!URL.canParse(value)) return false

  const protocol = new URL(value).protocol
  return protocol === "postgres:" || protocol === "postgresql:"
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
