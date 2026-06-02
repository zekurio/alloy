interface BrowserIdleTaskOptions {
  timeoutMs?: number
  fallbackDelayMs?: number
}

export function scheduleBrowserIdleTask(
  task: () => void,
  options: BrowserIdleTaskOptions = {},
): () => void {
  if (typeof window === "undefined") return () => undefined

  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(task, { timeout: options.timeoutMs })
    return () => window.cancelIdleCallback(id)
  }

  const timeout = globalThis.setTimeout(task, options.fallbackDelayMs ?? 0)
  return () => globalThis.clearTimeout(timeout)
}
