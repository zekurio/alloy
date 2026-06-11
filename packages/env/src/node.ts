import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

/**
 * Load the nearest `.env` file, walking up from `startDir` (defaults to the
 * working directory) until the workspace root. Variables already present in
 * the environment always win, so devenv/CI/production shells override the
 * file. No-op when no `.env` exists.
 *
 * Node-only (filesystem access); import via `alloy-env/node` so browser
 * bundles never pull this in.
 */
export function loadDotenv(startDir = process.cwd()): void {
  let dir = startDir
  for (;;) {
    const candidate = join(dir, ".env")
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate)
      return
    }
    // Don't escape the repository: a stray ~/.env must not leak in.
    if (
      existsSync(join(dir, "pnpm-workspace.yaml")) ||
      existsSync(join(dir, ".git"))
    ) {
      return
    }
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}
