function messageFromUnknown(cause: unknown): string | null {
  if (typeof cause === "string") {
    const message = cause.trim()
    return message.length > 0 ? message : null
  }

  if (cause instanceof Error) {
    const message = cause.message.trim()
    return message.length > 0 ? message : null
  }

  if (
    cause &&
    typeof cause === "object" &&
    "message" in cause &&
    typeof cause.message === "string"
  ) {
    const message = cause.message.trim()
    return message.length > 0 ? message : null
  }

  return null
}

export function errorMessage(cause: unknown, fallback: string): string {
  return messageFromUnknown(cause) ?? fallback
}

export function errorFrom(
  cause: unknown,
  fallback: string,
): { message: string } {
  return { message: errorMessage(cause, fallback) }
}

export function toError(cause: unknown, fallback: string): Error {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause
  return new Error(errorMessage(cause, fallback))
}
