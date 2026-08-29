import { join } from "node:path"

/**
 * Resolve renderer assets from Electron's application root.
 *
 * Main-process modules may be emitted into `out/main/chunks`, so a path based
 * on `import.meta.dirname` changes when Rollup moves a module between chunks.
 */
export function appRendererRoot(appPath: string): string {
  return join(appPath, "out", "renderer")
}

export function appRendererFile(appPath: string, filename: string): string {
  return join(appRendererRoot(appPath), filename)
}
