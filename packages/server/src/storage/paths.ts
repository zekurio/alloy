import type { StorageConfig } from "@alloy/contracts"
import { isAbsolute, resolve } from "@alloy/server/runtime/path"

export type StorageNamespace = "clips" | "users"

export function configuredFilesystemStoragePath(
  config: StorageConfig["fs"],
  namespace: StorageNamespace,
): string {
  return namespace === "clips" ? config.clipsPath : config.usersPath
}

export function filesystemStorageRoot(path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(path)
}
