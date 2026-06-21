import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"

import { t } from "@alloy/i18n"

export function sidecarEnv(
  runtimeDir: string | null,
  discordDetectionCachePath: string | null,
): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (discordDetectionCachePath) {
    env.ALLOY_DISCORD_DETECTIONS_PATH = discordDetectionCachePath
  }
  if (!runtimeDir) return env

  env.ALLOY_OBS_RUNTIME_DIR = runtimeDir
  prependEnvPath(env, "PATH", [
    runtimeDir,
    join(runtimeDir, "bin"),
    join(runtimeDir, "bin", "64bit"),
  ])
  prependEnvPath(env, "LD_LIBRARY_PATH", [
    join(runtimeDir, "lib"),
    join(runtimeDir, "lib64"),
    join(runtimeDir, "bin"),
    join(runtimeDir, "bin", "64bit"),
  ])
  return env
}

export function sidecarCwd(runtimeDir: string | null): string | undefined {
  if (!runtimeDir) return undefined

  for (const candidate of [
    join(runtimeDir, "bin", "64bit"),
    join(runtimeDir, "bin"),
    runtimeDir,
  ]) {
    if (existsSync(candidate)) return candidate
  }

  return undefined
}

export function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}

export function sidecarExitMessage(
  code: number | null,
  signal: NodeJS.Signals | null,
): string {
  if (signal) return `Recording sidecar exited from ${signal}.`
  if (code === null) return t("Recording sidecar exited.")
  return `Recording sidecar exited with code ${code}.`
}

function prependEnvPath(
  env: NodeJS.ProcessEnv,
  key: "PATH" | "LD_LIBRARY_PATH",
  paths: string[],
) {
  const envKey =
    Object.keys(env).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    ) ?? key
  const existing = env[envKey]
  const present = paths.filter((path) => existsSync(path))
  if (present.length === 0) return
  env[envKey] = existing
    ? [...present, existing].join(delimiter)
    : present.join(delimiter)
}
