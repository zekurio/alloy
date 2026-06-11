import type { Context, MiddlewareHandler } from "hono"

import { tooManyRequests } from "./http-response"

type Bucket = {
  count: number
  resetAt: number
}

const MAX_SWEEP_INTERVAL_MS = 60 * 1000

export function rateLimiter(opts: {
  windowMs: number
  max: number
  key: (c: Context) => string | null
  now?: () => number
}): MiddlewareHandler {
  const buckets = new Map<string, Bucket>()
  const now = opts.now ?? Date.now

  // This limiter is intentionally in-memory: Alloy's current direct-HLS cache
  // and media queue already assume one server process owns request handling.
  const sweep = setInterval(
    () => {
      const current = now()
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= current) buckets.delete(key)
      }
    },
    Math.min(opts.windowMs, MAX_SWEEP_INTERVAL_MS),
  )
  if (typeof sweep === "object" && "unref" in sweep) sweep.unref()

  return async (c, next) => {
    const key = opts.key(c)
    if (key === null) {
      await next()
      return
    }

    const current = now()
    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= current) {
      bucket = { count: 0, resetAt: current + opts.windowMs }
      buckets.set(key, bucket)
    }

    bucket.count += 1
    if (bucket.count > opts.max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((bucket.resetAt - current) / 1000),
      )
      return tooManyRequests(c, retryAfterSeconds)
    }

    await next()
  }
}
