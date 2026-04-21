import { env } from "../env"
import type { Cache } from "./driver"
import { MemoryCache } from "./memory"

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
