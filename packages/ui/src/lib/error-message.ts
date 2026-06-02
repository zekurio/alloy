export function messageFromUnknown(cause: unknown): string | null {
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
