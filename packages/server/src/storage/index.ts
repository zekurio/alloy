import { secretStore } from "@alloy/server/config/secret-store"
import { env } from "@alloy/server/env"
import { resolve } from "@alloy/server/runtime/path"

import type { StorageDriver } from "./driver"
import { FsStorageDriver } from "./fs-driver"
import { configuredFilesystemStoragePath, type StorageNamespace } from "./paths"

// Storage config is deploy-time env, so each namespace binds to its root once
// at load. Namespaces map to distinct roots on disk; the `user`/`game`/`data`
// aliases all share the assets root (the URL prefix, not the root, separates
// them — see storage/paths.ts and the key generators in driver.ts).
function createFsStorage(namespace: StorageNamespace): StorageDriver {
  return new FsStorageDriver({
    root: resolve(configuredFilesystemStoragePath(env.storage, namespace)),
    publicBaseUrl: env.PUBLIC_SERVER_URL,
    hmacSecret: secretStore.get("uploadHmacSecret"),
  })
}

export const clipStorage: StorageDriver = createFsStorage("clips")
export const clipThumbnailStorage: StorageDriver = createFsStorage("thumbnails")
export const assetStorage: StorageDriver = createFsStorage("assets")
export const userStorage: StorageDriver = assetStorage
export const gameAssetStorage: StorageDriver = assetStorage
export const dataStorage: StorageDriver = assetStorage

export function clipStorageForKey(key: string): StorageDriver {
  return isClipThumbnailKey(key) ? clipThumbnailStorage : clipStorage
}

function isClipThumbnailKey(key: string): boolean {
  // Every clip asset key generator must classify correctly here; routing is
  // asserted by storage/routing.test.ts.
  const filename = key.slice(key.lastIndexOf("/") + 1).toLowerCase()
  return (
    filename === "thumb.jpg" ||
    filename === "thumb-small.jpg" ||
    filename === "scrubber.jpg" ||
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
