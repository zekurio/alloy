import { logger } from "@workspace/logging"

type AbortSubscriber = {
  onAbort(listener: () => void | Promise<void>): void
}

type CancelableReadable = {
  cancel(reason?: unknown): Promise<void>
}

export function cancelReadableOnAbort(
  stream: AbortSubscriber,
  body: CancelableReadable,
  label: string
): void {
  stream.onAbort(() => {
    void body.cancel().catch((err) => {
      logger.warn(`[stream] failed to cancel ${label} after client abort:`, err)
    })
  })
}
