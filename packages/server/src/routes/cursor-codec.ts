import { t } from "@alloy/contracts/schema"
import {
  base64UrlDecodeText,
  base64UrlEncodeText,
} from "@alloy/server/encoding/base64url"

const CursorPayloadSchema = t.record(t.string(), t.unknown())
const CursorStringSchema = t.string()
const CursorNumberSchema = t.number()

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
  // Years outside 1-9999 would fail PostgreSQL's cast, so treat them as an
  // invalid cursor rather than a database error.
  const year = date.getUTCFullYear()
  return year >= 1 && year <= 9999 ? date : null
}

export function cursorRequiredString(value: CursorValue): string | null {
  const parsed = CursorStringSchema.safeParse(value)
  return parsed.success && parsed.data.trim() ? parsed.data : null
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
