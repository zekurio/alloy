import { base64UrlDecodeText, base64UrlEncodeText } from "../encoding/base64url"

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

export function cursorFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function cursorNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}
