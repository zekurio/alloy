import { resolve } from "node:path"

import { env } from "@alloy/server/env"

import { clipKeyDeletionNamespace } from "./clip-key"
import { FsStorageDriver } from "./fs-driver"
import { configuredFilesystemStoragePath, type StorageNamespace } from "./paths"

// Storage config is deploy-time env, so each namespace binds to its root
// once. User and game assets share the assets root.
function createFsStorage(namespace: StorageNamespace): FsStorageDriver {
  return new FsStorageDriver({
    root: resolve(configuredFilesystemStoragePath(env.storage, namespace)),
  })
}

export const clipStorage = createFsStorage("clips")
export const clipThumbnailStorage = createFsStorage("thumbnails")
export const assetStorage = createFsStorage("assets")

export function clipStorageForKey(key: string): FsStorageDriver {
  return clipKeyDeletionNamespace(key) === "thumbnails"
    ? clipThumbnailStorage
    : clipStorage
}

export { versionedAssetKey } from "./driver"
