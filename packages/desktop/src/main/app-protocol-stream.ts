const RESPONSE_HEADER_TIMEOUT_MS = 15_000

/** Stop proxy requests that never produce headers without timing out their body. */
export function responseHeaderDeadline(
  requestSignal: AbortSignal,
  timeoutMs = RESPONSE_HEADER_TIMEOUT_MS,
) {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), timeoutMs)
  timer.unref()

  return {
    signal: AbortSignal.any([requestSignal, timeout.signal]),
    timedOut: () => timeout.signal.aborted,
    clear: () => clearTimeout(timer),
  }
}

/** Preserve cancellation across Electron's Response-to-Node-stream bridge. */
export function proxyResponseBody(
  body: ReadableStream<Uint8Array> | null,
  requestSignal: AbortSignal,
): ReadableStream<Uint8Array> | null {
  if (!body) return null

  const reader = body.getReader()
  let output: ReadableStreamDefaultController<Uint8Array> | null = null
  let finished = false

  function finish(): boolean {
    if (finished) return false
    finished = true
    requestSignal.removeEventListener("abort", abort)
    return true
  }

  function abort(): void {
    if (!finish()) return
    output?.error(requestSignal.reason)
    void reader.cancel(requestSignal.reason).catch(() => undefined)
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller
      if (requestSignal.aborted) abort()
      else requestSignal.addEventListener("abort", abort, { once: true })
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (finished) return
        if (done) {
          finish()
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (cause) {
        if (!finish()) return
        controller.error(cause)
      }
    },
    cancel(reason) {
      if (!finish()) return
      return reader.cancel(reason).catch(() => undefined)
    },
  })
}
