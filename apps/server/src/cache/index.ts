import { env } from "../env"
import type { Cache } from "./driver"
import { MemoryCache } from "./memory"

/**
 * Singleton cache driver, selected at module load via `env.CACHE_DRIVER`.
 * Mirrors the `storage` singleton in `apps/server/src/storage/index.ts`
 * — one long-lived instance for the lifetime of the process.
 *
 * To add a new driver (e.g. redis), branch on the env value and
 * instantiate the new class here. Call sites only ever import `cache`
 * and lean on the `Cache` interface.
 */
function buildCache(): Cache {
  switch (env.CACHE_DRIVER) {
    case "memory":
      return new MemoryCache()
    default: {
      // Exhaustiveness check — adding a new variant to `CACHE_DRIVER`
      // without handling it here is a compile error.
      const exhaustive: never = env.CACHE_DRIVER
      throw new Error(`Unsupported CACHE_DRIVER: ${exhaustive as string}`)
    }
  }
}

export const cache: Cache = buildCache()

export type { Cache } from "./driver"
