import {
  base64UrlDecodeText,
  base64UrlEncodeText,
} from "@alloy/server/encoding/base64url"

type CursorPayload = Record<string, unknown>

export function decodeCursorPayload(
  value: string | undefined,
): CursorPayload | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(base64UrlDecodeText(value)) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null
    }
    return parsed as CursorPayload
  } catch {
    return null
  }
}

export function encodeCursorPayload(payload: object): string {
  return base64UrlEncodeText(JSON.stringify(payload))
}

export function cursorDate(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function cursorRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

// Postgres timestamptz::text output, e.g. "2026-07-04 12:34:56.123456+00".
// Validated before a decoded cursor value is cast back to ::timestamptz so a
// crafted cursor can't raise a DB error mid-query.
const TIMESTAMPTZ_TEXT =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2}){0,2}$/

export function cursorTimestamptzText(value: unknown): string | null {
  return typeof value === "string" && TIMESTAMPTZ_TEXT.test(value)
    ? value
    : null
}

export function cursorFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function cursorNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}
