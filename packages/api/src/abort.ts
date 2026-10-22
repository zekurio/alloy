/** True for the AbortError that fetch, XHR wrappers and AbortSignal raise. */
export function isAbortError(cause: unknown): boolean {
  return (
    (cause instanceof DOMException || cause instanceof Error) &&
    cause.name === "AbortError"
  )
}

export function abortError(message = "Operation aborted"): DOMException {
  return new DOMException(message, "AbortError")
}

export function throwIfAborted(
  signal: AbortSignal | undefined,
  message?: string,
): void {
  if (signal?.aborted) throw abortError(message)
}
