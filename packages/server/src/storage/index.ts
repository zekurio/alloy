import type { UploadTicketRole } from "@alloy/contracts"
import { secretStore } from "@alloy/server/config/secret-store"
import { configStore } from "@alloy/server/config/store"
import { env } from "@alloy/server/env"

import type { StorageDriver } from "./driver"
import { FsStorageDriver } from "./fs-driver"
import {
  configuredFilesystemStoragePath,
  filesystemStorageRoot,
  type StorageNamespace,
} from "./paths"

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
  writeUploadPart: StorageDriver["writeUploadPart"] = (...args) =>
    this.driver().writeUploadPart(...args)
  completeUpload: StorageDriver["completeUpload"] = (...args) =>
    this.driver().completeUpload(...args)
  abortUpload: StorageDriver["abortUpload"] = (...args) =>
    this.driver().abortUpload(...args)
  mintDownloadUrl: StorageDriver["mintDownloadUrl"] = (...args) =>
    this.driver().mintDownloadUrl(...args)
  delete: StorageDriver["delete"] = (...args) => this.driver().delete(...args)
  downloadToFile: StorageDriver["downloadToFile"] = (...args) =>
    this.driver().downloadToFile(...args)
  uploadFromFile: StorageDriver["uploadFromFile"] = (...args) =>
    this.driver().uploadFromFile(...args)
  copy: StorageDriver["copy"] = (...args) => this.driver().copy(...args)

  private driver(): StorageDriver {
    const storage = configStore.get("storage")
    const fsPath = configuredFilesystemStoragePath(storage.fs, this.namespace)
    const cacheKey = JSON.stringify({
      namespace: this.namespace,
      driver: storage.driver,
      fsPath,
    })

    if (this.cachedDriver && this.cachedKey === cacheKey) {
      return this.cachedDriver
    }

    const driver = new FsStorageDriver({
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
export const clipThumbnailStorage: StorageDriver = new ConfiguredStorageDriver(
  "thumbnails",
)
export const userStorage: StorageDriver = new ConfiguredStorageDriver("users")
export const gameAssetStorage: StorageDriver = new ConfiguredStorageDriver(
  "games",
)
export const dataStorage: StorageDriver = userStorage

export function clipStorageForUploadRole(
  role: UploadTicketRole,
): StorageDriver {
  return role === "thumb" ? clipThumbnailStorage : clipStorage
}

export function clipStorageForKey(key: string): StorageDriver {
  return isClipThumbnailKey(key) ? clipThumbnailStorage : clipStorage
}

function isClipThumbnailKey(key: string): boolean {
  const filename = key.slice(key.lastIndexOf("/") + 1).toLowerCase()
  return (
    filename === "thumb.jpg" ||
    filename === "thumb-small.jpg" ||
    (filename.startsWith("thumb-") && filename.endsWith(".jpg"))
  )
}

export type { StorageDriver, UploadTicket, UserAssetRole } from "./driver"
export {
  clipAssetDir,
  clipAssetKey,
  gameAssetKey,
  userAssetKey,
} from "./driver"
