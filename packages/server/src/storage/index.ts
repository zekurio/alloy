import { secretStore } from "@alloy/server/config/secret-store"
import { env } from "@alloy/server/env"
import { CLIPS_DIR, DATA_DIR } from "@alloy/server/runtime/dirs"

import type { StorageDriver } from "./driver"
import { FsStorageDriver } from "./fs-driver"

const uploadHmacSecret = secretStore.get("uploadHmacSecret")

/**
 * Bulk clip media: sources and thumbnails. Lives at
 * ALLOY_CLIPS_DIR — the single location meant for a large volume. Mints signed
 * browser upload tickets, so it carries the upload secret + public origin.
 */
export const clipStorage: StorageDriver = new FsStorageDriver({
  root: CLIPS_DIR,
  publicBaseUrl: env.PUBLIC_SERVER_URL,
  hmacSecret: uploadHmacSecret,
})

/**
 * App-owned assets: user avatars/banners. Lives under the
 * data dir on fast local disk. Server-side writes only — it never mints upload
 * tickets, but shares the same FS driver implementation.
 */
export const dataStorage: StorageDriver = new FsStorageDriver({
  root: DATA_DIR,
  publicBaseUrl: env.PUBLIC_SERVER_URL,
  hmacSecret: uploadHmacSecret,
})

export type { StorageDriver, UploadTicket, UserAssetRole } from "./driver"
export { clipAssetDir, clipAssetKey, userAssetKey } from "./driver"
