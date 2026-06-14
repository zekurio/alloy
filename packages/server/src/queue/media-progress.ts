import { createLogger } from "@alloy/logging"

const logger = createLogger("queue")

/**
 * Throttled progress writer shared by every media store. `commit` persists the
 * percent (returning whether the row actually advanced) and `onCommitted` fires
 * the side-channel notification only when it did.
 */
export function makeMediaProgressWriter(opts: {
  id: string
  commit: (pct: number) => Promise<boolean>
  onCommitted: (pct: number) => void
}): (pct: number) => void {
  let lastWrittenPct = 0
  let lastWriteAt = 0
  return (pct: number) => {
    const now = Date.now()
    if (pct <= lastWrittenPct) return
    if (now - lastWriteAt < 2000 && pct < 99) return
    lastWrittenPct = pct
    lastWriteAt = now
    opts
      .commit(pct)
      .then((advanced) => {
        if (advanced) opts.onCommitted(pct)
      })
      .catch((err: unknown) => {
        logger.error(`progress update failed for ${opts.id}:`, err)
      })
  }
}
