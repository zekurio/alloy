import type { StorageConfig } from "@alloy/contracts"

export type StorageNamespace = "clips" | "thumbnails" | "assets"

export function configuredFilesystemStoragePath(
  config: StorageConfig,
  namespace: StorageNamespace,
): string {
  if (namespace === "clips") return config.clipsPath
  if (namespace === "thumbnails") return config.thumbnailsPath
  return config.assetsPath
}
