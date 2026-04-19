import { env } from "../env"
import type { StorageDriver } from "./driver"
import { FsStorageDriver } from "./fs-driver"

/**
 * Singleton storage driver, selected at module load via `env.STORAGE_DRIVER`.
 * Mirrors the `db` singleton in `apps/server/src/db/index.ts` — one
 * long-lived instance for the lifetime of the process.
 *
 * To add a new driver, branch on the env value and instantiate the new
 * class here. Call sites only ever import `storage` and lean on the
 * `StorageDriver` interface.
 */
function buildStorage(): StorageDriver {
  switch (env.STORAGE_DRIVER) {
    case "fs":
      return new FsStorageDriver({
        root: env.STORAGE_FS_ROOT,
        publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL,
        hmacSecret: env.STORAGE_HMAC_SECRET,
      })
    default: {
      // Exhaustiveness check — adding a new variant to `STORAGE_DRIVER`
      // without handling it here is a compile error.
      const exhaustive: never = env.STORAGE_DRIVER
      throw new Error(`Unsupported STORAGE_DRIVER: ${exhaustive as string}`)
    }
  }
}

export const storage: StorageDriver = buildStorage()

export type { StorageDriver, UploadTicket } from "./driver"
export { clipAssetKey } from "./driver"
