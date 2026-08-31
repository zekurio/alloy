import { secretStore } from "@alloy/server/config/secret-store"
import { env } from "@alloy/server/env"
import { lazy } from "@alloy/server/runtime/lazy"
import { resolve } from "@alloy/server/runtime/path"

import { clipKeyDeletionNamespace } from "./clip-key"
import type { StorageDriver } from "./driver"
import { FsStorageDriver } from "./fs-driver"
import { configuredFilesystemStoragePath, type StorageNamespace } from "./paths"

// Storage config is deploy-time env, so each namespace binds to its root once,
// on first use. Namespaces map to distinct roots on disk; the `user`/`game`/
// `data` aliases all share the assets root (the URL prefix, not the root,
// separates them — see storage/paths.ts and the key generators in driver.ts).
function createFsStorage(namespace: StorageNamespace): StorageDriver {
  return lazy(
    () =>
      new FsStorageDriver({
        root: resolve(configuredFilesystemStoragePath(env.storage, namespace)),
        publicBaseUrl: env.PUBLIC_SERVER_URL,
        hmacSecret: secretStore.get("uploadHmacSecret"),
      }),
  )
}

export const clipStorage: StorageDriver = createFsStorage("clips")
export const clipThumbnailStorage: StorageDriver = createFsStorage("thumbnails")
export const assetStorage: StorageDriver = createFsStorage("assets")
export const userStorage: StorageDriver = assetStorage
export const gameAssetStorage: StorageDriver = assetStorage
export const dataStorage: StorageDriver = assetStorage

export function clipStorageForKey(key: string): StorageDriver {
  return clipKeyDeletionNamespace(key) === "thumbnails"
    ? clipThumbnailStorage
    : clipStorage
}

export type { StorageDriver, UploadTicket, UserAssetRole } from "./driver"
export {
  clipAssetDir,
  clipAssetKey,
  gameAssetKey,
  userAssetKey,
  versionedUserAssetKey,
} from "./driver"
