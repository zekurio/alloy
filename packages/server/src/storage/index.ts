import { secretStore } from "@alloy/server/config/secret-store"
import { configStore } from "@alloy/server/config/store"
import { env } from "@alloy/server/env"

import type { StorageDriver } from "./driver"
import { FsStorageDriver } from "./fs-driver"
import {
  configuredFilesystemStoragePath,
  filesystemStorageRoot,
  objectStoragePrefix,
  type StorageNamespace,
} from "./paths"
import { S3StorageDriver } from "./s3-driver"

const uploadHmacSecret = secretStore.get("uploadHmacSecret")

class ConfiguredStorageDriver implements StorageDriver {
  private cachedKey: string | null = null
  private cachedDriver: StorageDriver | null = null

  constructor(private readonly namespace: StorageNamespace) {}

  put: StorageDriver["put"] = (...args) => this.driver().put(...args)
  resolve: StorageDriver["resolve"] = (...args) =>
    this.driver().resolve(...args)
  mintUploadUrl: StorageDriver["mintUploadUrl"] = (...args) =>
    this.driver().mintUploadUrl(...args)
  delete: StorageDriver["delete"] = (...args) => this.driver().delete(...args)
  downloadToFile: StorageDriver["downloadToFile"] = (...args) =>
    this.driver().downloadToFile(...args)
  uploadFromFile: StorageDriver["uploadFromFile"] = (...args) =>
    this.driver().uploadFromFile(...args)
  copy: StorageDriver["copy"] = (...args) => this.driver().copy(...args)

  private driver(): StorageDriver {
    const storage = configStore.get("storage")
    const fsPath = configuredFilesystemStoragePath(storage.fs, this.namespace)
    const prefix = objectStoragePrefix(this.namespace)
    const credentials = secretStore.storageS3Credentials()
    const cacheKey = JSON.stringify({
      namespace: this.namespace,
      driver: storage.driver,
      fsPath,
      prefix,
      s3: storage.s3,
      credentials,
    })

    if (this.cachedDriver && this.cachedKey === cacheKey) {
      return this.cachedDriver
    }

    const driver =
      storage.driver === "s3"
        ? new S3StorageDriver({
            ...storage.s3,
            prefix,
            credentials:
              credentials ??
              missingS3Credentials(this.namespace, storage.s3.bucket),
          })
        : new FsStorageDriver({
            root: filesystemStorageRoot(fsPath),
            publicBaseUrl: env.PUBLIC_SERVER_URL,
            hmacSecret: uploadHmacSecret,
          })

    this.cachedKey = cacheKey
    this.cachedDriver = driver
    return driver
  }
}

export const clipStorage: StorageDriver = new ConfiguredStorageDriver("clips")
export const userStorage: StorageDriver = new ConfiguredStorageDriver("users")
export const dataStorage: StorageDriver = userStorage

export type { StorageDriver, UploadTicket, UserAssetRole } from "./driver"
export { clipAssetDir, clipAssetKey, userAssetKey } from "./driver"

function missingS3Credentials(
  namespace: StorageNamespace,
  bucket: string,
): never {
  const target = bucket ? `bucket ${bucket}` : "the configured S3 bucket"
  throw new Error(
    `S3 ${namespace} storage is configured for ${target}, but S3 credentials are missing.`,
  )
}
