const controller = new AbortController()

export const shutdownSignal = controller.signal

export function requestShutdown(): void {
  if (controller.signal.aborted) return
  controller.abort()
}
