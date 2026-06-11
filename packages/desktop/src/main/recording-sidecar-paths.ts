import { existsSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

import { app } from "electron"

/**
 * Filesystem discovery for the recording sidecar: where the `@alloy/recorder`
 * binary lives and which OBS runtime it should load. Pure lookups with no
 * recording state.
 */

export function sidecarExecutablePath(): string {
  const executable =
    process.platform === "win32" ? "@alloy/recorder.exe" : "@alloy/recorder"
  if (app.isPackaged) return join(process.resourcesPath, "sidecar", executable)
  return join(app.getAppPath(), "..", "recorder", "dist", "sidecar", executable)
}

export function obsRuntimeDir(): string | null {
  const configured = process.env.ALLOY_OBS_RUNTIME_DIR
  const configuredRuntime = configured
    ? normalizeObsRuntimeDir(configured)
    : null
  if (configuredRuntime) return configuredRuntime

  const bundled = app.isPackaged
    ? join(process.resourcesPath, "obs-runtime")
    : join(app.getAppPath(), "..", "recorder", "dist", "obs-runtime")
  const bundledRuntime = normalizeObsRuntimeDir(bundled)
  if (bundledRuntime) return bundledRuntime

  for (const candidate of systemObsRuntimeCandidates()) {
    const runtime = normalizeObsRuntimeDir(candidate)
    if (runtime) return runtime
  }

  return null
}

function normalizeObsRuntimeDir(candidate: string): string | null {
  if (!existsSync(candidate)) return null

  const resolved = resolve(candidate)
  if (
    basenameInsensitive(resolved) === "64bit" &&
    basenameInsensitive(dirname(resolved)) === "bin"
  ) {
    const root = dirname(dirname(resolved))
    if (hasObsLibrary(join(root, "bin", "64bit"))) return root
  }

  if (basenameInsensitive(resolved) === "bin") {
    const root = dirname(resolved)
    if (hasObsLibrary(join(root, "bin"))) return root
  }

  if (hasObsLibrary(resolved)) return resolved
  if (hasObsLibrary(join(resolved, "bin", "64bit"))) return resolved
  if (hasObsLibrary(join(resolved, "bin"))) return resolved

  return null
}

function hasObsLibrary(candidate: string): boolean {
  return existsSync(join(candidate, "obs.dll"))
}

function systemObsRuntimeCandidates(): string[] {
  if (process.platform !== "win32") return []

  return [
    process.env.ProgramW6432,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ]
    .filter((path): path is string => Boolean(path))
    .map((path) => join(path, "obs-studio"))
}

function basenameInsensitive(path: string): string {
  return basename(path).toLowerCase()
}
