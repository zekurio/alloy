export function errorMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback

  const message = cause.message.trim()
  return message.length > 0 ? message : fallback
}

export function errorDetail(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return errorMessage(cause, fallback)
  const parsed = ErrorDetailSchema.safeParse(cause)
  if (!parsed.success) return fallback

  const message = parsed.data.trim()
  return message.length > 0 ? message : fallback
}

export function toError(cause: unknown, fallback: string): Error {
  if (cause instanceof Error) return cause
  return new Error(errorDetail(cause, fallback))
}

export function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError"
}
import { t } from "@alloy/contracts/schema"

const ErrorDetailSchema = t.string()
