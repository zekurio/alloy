import type { StorageConfig } from "@alloy/contracts"
import { DATA_DIR } from "@alloy/server/runtime/dirs"
import { isAbsolute, join, resolve } from "@alloy/server/runtime/path"

import { normalizeObjectPath } from "./object-path"

export type StorageNamespace = "clips" | "users"

export function configuredStoragePath(
  config: Pick<StorageConfig, "clipsPath" | "path" | "usersPath">,
  namespace: StorageNamespace,
): string {
  const override = namespace === "clips" ? config.clipsPath : config.usersPath
  return override ?? joinStoragePath(config.path, namespace)
}

export function filesystemStorageRoot(path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(DATA_DIR, path)
}

export function objectStoragePrefix(path: string): string {
  return normalizeObjectPath(path)
}

export function joinStoragePath(root: string, child: string): string {
  return join(root, child)
}

export { normalizeObjectPath }
