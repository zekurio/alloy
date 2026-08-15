import { t } from "@alloy/contracts/schema"
import {
  base64UrlDecodeText,
  base64UrlEncodeText,
} from "@alloy/server/encoding/base64url"

const CursorPayloadSchema = t.record(t.string(), t.unknown())
const CursorStringSchema = t.string()
const CursorNumberSchema = t.number()
const CursorBooleanSchema = t.boolean()

type CursorPayload = t.infer<typeof CursorPayloadSchema>
type CursorValue = CursorPayload[string]

export function decodeCursorPayload(
  value: string | undefined,
): CursorPayload | null {
  if (!value) return null
  try {
    const parsed = CursorPayloadSchema.safeParse(
      JSON.parse(base64UrlDecodeText(value)),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function encodeCursorPayload(payload: CursorPayload): string {
  return base64UrlEncodeText(JSON.stringify(payload))
}

export function cursorDate(value: CursorValue): Date | null {
  const parsed = CursorStringSchema.safeParse(value)
  if (!parsed.success) return null
  const date = new Date(parsed.data)
  return Number.isNaN(date.getTime()) ? null : date
}

export function cursorRequiredString(value: CursorValue): string | null {
  const parsed = CursorStringSchema.safeParse(value)
  return parsed.success && parsed.data.trim() ? parsed.data : null
}

export function cursorBoolean(value: CursorValue): boolean | null {
  const parsed = CursorBooleanSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

// Postgres timestamptz::text output, e.g. "2026-07-04 12:34:56.123456+00".
// Validated before a decoded cursor value is cast back to ::timestamptz so a
// crafted cursor can't raise a DB error mid-query.
const TIMESTAMPTZ_TEXT =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2}){0,2}$/

export function cursorTimestamptzText(value: CursorValue): string | null {
  const parsed = CursorStringSchema.safeParse(value)
  return parsed.success && TIMESTAMPTZ_TEXT.test(parsed.data)
    ? parsed.data
    : null
}

// Postgres timestamp (without time zone) ::text output, e.g.
// "2026-07-04 12:34:56.123456". Users' created_at is a plain timestamp, so its
// cursor is validated against this (no zone offset) before casting to ::timestamp.
const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/

export function cursorTimestampText(value: CursorValue): string | null {
  const parsed = CursorStringSchema.safeParse(value)
  return parsed.success && TIMESTAMP_TEXT.test(parsed.data) ? parsed.data : null
}

export function cursorFiniteNumber(value: CursorValue): number | null {
  const parsed = CursorNumberSchema.safeParse(value)
  return parsed.success && Number.isFinite(parsed.data) ? parsed.data : null
}

export function cursorNonNegativeInteger(value: CursorValue): number | null {
  const parsed = CursorNumberSchema.safeParse(value)
  return parsed.success && Number.isSafeInteger(parsed.data) && parsed.data >= 0
    ? parsed.data
    : null
}
