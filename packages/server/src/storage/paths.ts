import type { StorageConfig } from "@alloy/contracts"
import { isAbsolute, resolve } from "@alloy/server/runtime/path"

export type StorageNamespace = "clips" | "thumbnails" | "users"

export function configuredFilesystemStoragePath(
  config: StorageConfig["fs"],
  namespace: StorageNamespace,
): string {
  if (namespace === "clips") return config.clipsPath
  if (namespace === "thumbnails") return config.thumbnailsPath
  return config.usersPath
}

export function filesystemStorageRoot(path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(path)
}
