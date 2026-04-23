import { env } from "../env"
import type { StorageDriver } from "./driver"
import { FsStorageDriver } from "./fs-driver"
import { S3StorageDriver } from "./s3-driver"

function buildStorage(): StorageDriver {
  switch (env.STORAGE_DRIVER) {
    case "fs":
      if (!env.STORAGE_HMAC_SECRET) {
        // Safety net — the env superRefine already enforces this, but
        // typescript can't narrow across that boundary.
        throw new Error("STORAGE_DRIVER=fs requires STORAGE_HMAC_SECRET")
      }
      return new FsStorageDriver({
        root: env.STORAGE_FS_ROOT,
        publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL,
        hmacSecret: env.STORAGE_HMAC_SECRET,
      })
    case "s3":
      if (!env.S3_BUCKET) {
        // Safety net — the env superRefine already enforces this, but
        // typescript can't narrow across that boundary.
        throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET")
      }
      return new S3StorageDriver({
        bucket: env.S3_BUCKET,
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        presignExpiresSec: env.S3_PRESIGN_EXPIRES_SEC,
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

export type { StorageDriver, UploadTicket, UserAssetRole } from "./driver"
export { clipAssetKey, clipVideoVariantKey, userAssetKey } from "./driver"
