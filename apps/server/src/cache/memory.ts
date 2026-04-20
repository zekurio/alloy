import type { Cache } from "./driver"

/**
 * In-process `Cache` implementation backed by a `Map` of key → expiry
 * epoch ms. No external dependency, no ops surface — the trade-off is
 * that state is per-process. Horizontal scale-out needs a shared driver
 * (redis) because each instance's Map is invisible to the others; a
 * viewer who lands on two different instances within the dedup window
 * would be counted twice.
 *
 * Expiry is handled two ways:
 *   - Lazy: `setIfAbsent` treats an expired entry as absent and
 *     overwrites it. This is what keeps the dedup correct for hot keys
 *     that actually get re-read.
 *   - Sweep: a background `setInterval` walks the map every
 *     `SWEEP_INTERVAL_MS` and deletes entries past their expiry so cold
 *     keys don't pin memory forever. `.unref()`'d so the interval doesn't
 *     hold the process open during tests or graceful shutdown.
 *
 * The sweep runs in O(n) over the map. At expected self-hosted volumes
 * (tens of thousands of live keys) this is microseconds; if we ever saw
 * the map grow into the millions we'd already be on redis anyway.
 */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000

export class MemoryCache implements Cache {
  private readonly store = new Map<string, number>()
  private readonly sweepHandle: NodeJS.Timeout

  constructor() {
    this.sweepHandle = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    // Don't block Node from exiting on our account — the interval is
    // purely housekeeping. Tests that spin the cache up and tear it down
    // would otherwise hang on process exit.
    this.sweepHandle.unref()
  }

  async setIfAbsent(key: string, ttlSec: number): Promise<boolean> {
    const now = Date.now()
    const existingExpiry = this.store.get(key)
    // `existingExpiry > now` means the key is live; otherwise it's either
    // missing or expired, both of which count as "absent" for this op.
    if (existingExpiry !== undefined && existingExpiry > now) {
      return false
    }
    this.store.set(key, now + ttlSec * 1000)
    return true
  }

  /**
   * Test-only: wipe all keys. Not part of the `Cache` interface — a
   * redis driver has no equivalent (we'd `FLUSHDB` a whole namespace at
   * best) and consumers shouldn't depend on it.
   */
  clear(): void {
    this.store.clear()
  }

  /**
   * Test-only teardown: stop the sweep interval. Not part of the
   * interface; production processes keep the cache alive until exit.
   */
  dispose(): void {
    clearInterval(this.sweepHandle)
    this.store.clear()
  }

  private sweep(): void {
    const now = Date.now()
    for (const [key, expiry] of this.store) {
      if (expiry <= now) {
        this.store.delete(key)
      }
    }
  }
}
