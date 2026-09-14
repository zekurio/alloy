/* eslint-disable no-console */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  copyFileIfChanged,
  normalizeObsRuntimeDir,
  obsResourcesDir,
  pruneObsRuntime,
  recorderDir,
  agentResourcesDir,
  stageObsHelpers,
  stageObsRuntime,
} from "./obs-runtime.mjs"

const manifestPath = join(recorderDir, "Cargo.toml")
const binaryName = "alloy-agent.exe"
const requireObsRuntime =
  process.argv.includes("--require-obs-runtime") ||
  process.env.ALLOY_REQUIRE_OBS_RUNTIME === "1"
const release = process.argv.includes("--release")
const targetTriple = process.env.CARGO_BUILD_TARGET ?? process.env.CARGO_TARGET

if (process.platform !== "win32" && !requireObsRuntime && !targetTriple) {
  console.warn("Skipping alloy-agent build: the native agent is Windows-only.")
  mkdirSync(agentResourcesDir, { recursive: true })
  mkdirSync(obsResourcesDir, { recursive: true })
  writeFileSync(join(agentResourcesDir, ".gitkeep"), "")
  writeFileSync(join(obsResourcesDir, ".gitkeep"), "")
  process.exit(0)
}

const obsRuntimeSource = resolveObsRuntimeSource()

const cargoArgs = ["build", "--manifest-path", manifestPath]
if (release) cargoArgs.push("--release")
if (targetTriple) cargoArgs.push("--target", targetTriple)

const cargo = spawnSync("cargo", cargoArgs, { stdio: "inherit" })
if (cargo.error) {
  console.error(`Failed to run cargo: ${cargo.error.message}`)
  process.exit(1)
}
if (cargo.status !== 0) process.exit(cargo.status ?? 1)

// The recorder is a member of the root Cargo workspace, so its artifacts land
// in the workspace target directory unless CARGO_TARGET_DIR overrides it.
const targetRoot = resolve(
  process.env.CARGO_TARGET_DIR ?? join(recorderDir, "../../target"),
)
const profileDir = release ? "release" : "debug"
const buildDir = targetTriple
  ? join(targetRoot, targetTriple, profileDir)
  : join(targetRoot, profileDir)
const builtBinary = join(buildDir, binaryName)
if (!existsSync(builtBinary)) {
  console.error(`Sidecar build finished, but ${builtBinary} was not found.`)
  process.exit(1)
}

mkdirSync(agentResourcesDir, { recursive: true })
copyFileIfChanged(builtBinary, join(agentResourcesDir, binaryName))
writeFileSync(join(agentResourcesDir, ".gitkeep"), "")

stageObsRuntime(obsRuntimeSource)
stageObsHelpers()
pruneObsRuntime()

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

function failOrWarn(message) {
  if (requireObsRuntime) {
    console.error(message)
    process.exit(1)
  }

  console.warn(message)
  return null
}
