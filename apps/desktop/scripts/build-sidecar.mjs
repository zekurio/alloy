/* eslint-disable no-console */

import { spawnSync } from "node:child_process"
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const desktopDir = fileURLToPath(new URL("../", import.meta.url))
const sidecarDir = join(desktopDir, "sidecar")
const manifestPath = join(sidecarDir, "Cargo.toml")
const sidecarResourcesDir = join(desktopDir, "resources", "sidecar")
const obsResourcesDir = join(desktopDir, "resources", "obs-runtime")
const binaryName =
  process.platform === "win32" ? "alloy-recorder.exe" : "alloy-recorder"
const obsHelperExecutables = [
  "obs-ffmpeg-mux.exe",
  "obs-amf-test.exe",
  "obs-nvenc-test.exe",
  "obs-qsv-test.exe",
]
const requireObsRuntime =
  process.argv.includes("--require-obs-runtime") ||
  process.env.ALLOY_REQUIRE_OBS_RUNTIME === "1"

const obsRuntimeSource = resolveObsRuntimeSource()

const cargoArgs = ["build", "--manifest-path", manifestPath, "--release"]
const targetTriple = process.env.CARGO_BUILD_TARGET ?? process.env.CARGO_TARGET
if (targetTriple) cargoArgs.push("--target", targetTriple)

const cargo = spawnSync("cargo", cargoArgs, { stdio: "inherit" })
if (cargo.error) {
  console.error(`Failed to run cargo: ${cargo.error.message}`)
  process.exit(1)
}
if (cargo.status !== 0) process.exit(cargo.status ?? 1)

const targetRoot = resolve(
  process.env.CARGO_TARGET_DIR ?? join(sidecarDir, "target"),
)
const releaseDir = targetTriple
  ? join(targetRoot, targetTriple, "release")
  : join(targetRoot, "release")
const builtBinary = join(releaseDir, binaryName)
if (!existsSync(builtBinary)) {
  console.error(`Sidecar build finished, but ${builtBinary} was not found.`)
  process.exit(1)
}

mkdirSync(sidecarResourcesDir, { recursive: true })
cpSync(builtBinary, join(sidecarResourcesDir, binaryName))
if (process.platform !== "win32")
  chmodSync(join(sidecarResourcesDir, binaryName), 0o755)
writeFileSync(join(sidecarResourcesDir, ".gitkeep"), "")

stageObsRuntime(obsRuntimeSource)
stageObsHelpers()

function resolveObsRuntimeSource() {
  const runtimeDir = process.env.ALLOY_OBS_RUNTIME_DIR
  mkdirSync(obsResourcesDir, { recursive: true })

  if (!runtimeDir) {
    if (requireObsRuntime) {
      const stagedRuntime = normalizeObsRuntimeDir(obsResourcesDir)
      if (stagedRuntime) return stagedRuntime

      console.error(
        [
          "A valid OBS runtime is required for this build.",
          `Set ALLOY_OBS_RUNTIME_DIR to an OBS runtime root containing obs.dll, or pre-stage one in ${obsResourcesDir}.`,
        ].join("\n"),
      )
      process.exit(1)
    }

    return null
  }

  if (!existsSync(runtimeDir)) {
    return failOrWarn(`ALLOY_OBS_RUNTIME_DIR does not exist: ${runtimeDir}`)
  }

  const runtimeRoot = normalizeObsRuntimeDir(runtimeDir)
  if (!runtimeRoot) {
    return failOrWarn(
      `ALLOY_OBS_RUNTIME_DIR does not contain obs.dll in a supported OBS runtime layout: ${runtimeDir}`,
    )
  }

  return runtimeRoot
}

function stageObsRuntime(runtimeRoot) {
  mkdirSync(obsResourcesDir, { recursive: true })

  if (!runtimeRoot) {
    writeFileSync(join(obsResourcesDir, ".gitkeep"), "")
    return
  }

  if (resolve(runtimeRoot) === resolve(obsResourcesDir)) {
    writeFileSync(join(obsResourcesDir, ".gitkeep"), "")
    return
  }

  rmSync(obsResourcesDir, { recursive: true, force: true })
  mkdirSync(obsResourcesDir, { recursive: true })
  cpSync(runtimeRoot, obsResourcesDir, { recursive: true, dereference: true })
  writeFileSync(join(obsResourcesDir, ".gitkeep"), "")
}

function stageObsHelpers() {
  if (process.platform !== "win32") return

  for (const helper of obsHelperExecutables) {
    const helperPath = join(obsResourcesDir, "bin", "64bit", helper)
    if (existsSync(helperPath)) {
      cpSync(helperPath, join(sidecarResourcesDir, helper))
    }
  }
}

function failOrWarn(message) {
  if (requireObsRuntime) {
    console.error(message)
    process.exit(1)
  }

  console.warn(message)
  return null
}

function normalizeObsRuntimeDir(candidate) {
  const resolved = resolve(candidate)

  if (
    basenameInsensitive(resolved) === "64bit" &&
    basenameInsensitive(dirname(resolved)) === "bin"
  ) {
    const root = dirname(dirname(resolved))
    if (hasObsDll(join(root, "bin", "64bit"))) return root
  }

  if (basenameInsensitive(resolved) === "bin") {
    const root = dirname(resolved)
    if (hasObsDll(join(root, "bin"))) return root
  }

  if (hasObsDll(resolved)) return resolved
  if (hasObsDll(join(resolved, "bin", "64bit"))) return resolved
  if (hasObsDll(join(resolved, "bin"))) return resolved

  return null
}

function hasObsDll(candidate) {
  return existsSync(join(candidate, "obs.dll"))
}

function basenameInsensitive(path) {
  return basename(path).toLowerCase()
}
