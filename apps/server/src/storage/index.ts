import type { StorageConfig } from "@workspace/contracts"

import { configStore } from "../lib/config-store"
import type { StorageDriver } from "./driver"
import { FsStorageDriver } from "./fs-driver"
import { S3StorageDriver } from "./s3-driver"

function buildStorage(config: StorageConfig): StorageDriver {
  switch (config.driver) {
    case "fs":
      return new FsStorageDriver({
        root: config.fs.root,
        publicBaseUrl: config.fs.publicBaseUrl,
        hmacSecret: config.fs.hmacSecret,
      })
    case "s3":
      return new S3StorageDriver({
        bucket: config.s3.bucket,
        region: config.s3.region,
        endpoint: config.s3.endpoint,
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
        forcePathStyle: config.s3.forcePathStyle,
        presignExpiresSec: config.s3.presignExpiresSec,
      })
    default: {
      // Exhaustiveness check — adding a new variant to `STORAGE_DRIVER`
      // without handling it here is a compile error.
      const exhaustive: never = config
      throw new Error(
        `Unsupported STORAGE_DRIVER: ${JSON.stringify(exhaustive)}`
      )
    }
  }
}

let activeStorage = buildStorage(configStore.get("storage"))

configStore.subscribe((next, prev) => {
  if (next.storage === prev.storage) return
  activeStorage = buildStorage(next.storage)
})

class ReloadableStorageDriver implements StorageDriver {
  put: StorageDriver["put"] = (...args) => activeStorage.put(...args)
  resolve: StorageDriver["resolve"] = (...args) =>
    activeStorage.resolve(...args)
  mintUploadUrl: StorageDriver["mintUploadUrl"] = (...args) =>
    activeStorage.mintUploadUrl(...args)
  delete: StorageDriver["delete"] = (...args) => activeStorage.delete(...args)
  downloadToFile: StorageDriver["downloadToFile"] = (...args) =>
    activeStorage.downloadToFile(...args)
  uploadFromFile: StorageDriver["uploadFromFile"] = (...args) =>
    activeStorage.uploadFromFile(...args)
  copy: StorageDriver["copy"] = (...args) => activeStorage.copy(...args)
  mintDownloadUrl: StorageDriver["mintDownloadUrl"] = (...args) =>
    activeStorage.mintDownloadUrl(...args)
}

export function getStorageDriver(): StorageDriver {
  return activeStorage
}

export function getStorageConfig(): StorageConfig {
  return configStore.get("storage")
}

export const storage: StorageDriver = new ReloadableStorageDriver()

export type { StorageDriver, UploadTicket, UserAssetRole } from "./driver"
export {
  clipAssetKey,
  clipOriginalAssetKey,
  clipSourceAssetKey,
  clipSourceMp4Key,
  clipStagingThumbKey,
  clipStagingVideoKey,
  clipVideoVariantKey,
  userAssetKey,
} from "./driver"
