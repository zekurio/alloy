import { messageFromUnknown } from "@alloy/contracts"

import { HttpError } from "./http"

export function errorMessage(cause: unknown, fallback: string): string {
  return messageFromUnknown(cause) ?? fallback
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
