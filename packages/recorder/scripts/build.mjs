/* eslint-disable no-console */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  copyFileIfChanged,
  distDir,
  normalizeObsRuntimeDir,
  obsResourcesDir,
  pruneObsRuntime,
  recorderDir,
  sidecarResourcesDir,
  stageObsHelpers,
  stageObsRuntime,
} from "./obs-runtime.mjs"

const manifestPath = join(recorderDir, "Cargo.toml")
const binaryName = "alloy-recorder.exe"
const requireObsRuntime =
  process.argv.includes("--require-obs-runtime") ||
  process.env.ALLOY_REQUIRE_OBS_RUNTIME === "1"
const targetTriple = process.env.CARGO_BUILD_TARGET ?? process.env.CARGO_TARGET

if (process.platform !== "win32" && !requireObsRuntime && !targetTriple) {
  console.warn("Skipping alloy-recorder build: the sidecar is Windows-only.")
  mkdirSync(sidecarResourcesDir, { recursive: true })
  mkdirSync(obsResourcesDir, { recursive: true })
  writeFileSync(join(sidecarResourcesDir, ".gitkeep"), "")
  writeFileSync(join(obsResourcesDir, ".gitkeep"), "")
  writeManifest()
  process.exit(0)
}

const obsRuntimeSource = resolveObsRuntimeSource()

const detections = spawnSync(
  process.execPath,
  [join(recorderDir, "scripts", "generate-discord-detections.mjs")],
  { stdio: "inherit" },
)
if (detections.error) {
  console.error(
    `Failed to generate Discord detections: ${detections.error.message}`,
  )
  process.exit(1)
}
if (detections.status !== 0) process.exit(detections.status ?? 1)

const cargoArgs = ["build", "--manifest-path", manifestPath, "--release"]
if (targetTriple) cargoArgs.push("--target", targetTriple)

const cargo = spawnSync("cargo", cargoArgs, { stdio: "inherit" })
if (cargo.error) {
  console.error(`Failed to run cargo: ${cargo.error.message}`)
  process.exit(1)
}
if (cargo.status !== 0) process.exit(cargo.status ?? 1)

const targetRoot = resolve(
  process.env.CARGO_TARGET_DIR ?? join(recorderDir, "target"),
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
copyFileIfChanged(builtBinary, join(sidecarResourcesDir, binaryName))
writeFileSync(join(sidecarResourcesDir, ".gitkeep"), "")
writeManifest()

stageObsRuntime(obsRuntimeSource)
stageObsHelpers()
pruneObsRuntime()

function writeManifest() {
  const packageJson = JSON.parse(
    readFileSync(join(recorderDir, "package.json"), "utf8"),
  )
  const manifest = {
    name: packageJson.name,
    version: packageJson.version,
    protocolVersion: 1,
    platform: process.platform,
    arch: process.arch,
    binary: binaryName,
    capabilities: [
      "game-capture",
      "audio-devices",
      "audio-applications",
      "game-processes",
      "replay-buffer",
    ],
  }

  writeFileSync(
    join(distDir, "recorder.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
}

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
