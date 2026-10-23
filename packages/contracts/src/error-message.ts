import { isObjectRecord, isStringValue } from "./object"

/** The trimmed message a thrown value carries, or null when it has none. */
export function messageFromUnknown(cause: unknown): string | null {
  const message = rawMessage(cause)?.trim()
  return message ? message : null
}

function rawMessage(cause: unknown): string | null {
  if (isStringValue(cause)) return cause
  if (cause instanceof Error) return cause.message
  if (isObjectRecord(cause) && isStringValue(cause.message)) {
    return cause.message
  }
  return null
}
