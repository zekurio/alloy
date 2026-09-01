import { join } from "node:path"

/**
 * Resolve local renderer assets from Electron's application root.
 *
 * Main-process modules may be emitted into `out/main/chunks`, so a path based
 * on `import.meta.dirname` changes when Rollup moves a module between chunks.
 */
export function rendererRoot(appPath: string): string {
  return join(appPath, "out", "renderer")
}

export function rendererFile(appPath: string, filename: string): string {
  return join(rendererRoot(appPath), filename)
}
