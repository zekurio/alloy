import { isObjectRecord, isStringValue } from "@alloy/contracts"

import { HttpError } from "./http"

function messageFromUnknown(cause: unknown): string | null {
  if (isStringValue(cause)) {
    const message = cause.trim()
    return message.length > 0 ? message : null
  }

  if (cause instanceof Error) {
    const message = cause.message.trim()
    return message.length > 0 ? message : null
  }

  if (isObjectRecord(cause) && isStringValue(cause.message)) {
    const message = cause.message.trim()
    return message.length > 0 ? message : null
  }

  return null
}

export function errorMessage(cause: unknown, fallback: string): string {
  const message = messageFromUnknown(cause)
  if (message !== null) return message
  return fallback
}

export function errorFrom(cause: unknown, fallback: string) {
  const message = errorMessage(cause, fallback)
  return cause instanceof HttpError && cause.code
    ? { message, code: cause.code }
    : { message }
}

export function toError(cause: unknown, fallback: string): Error {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause
  return new Error(errorMessage(cause, fallback))
}
