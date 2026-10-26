import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"

import {
  copyFileIfChanged,
  resourcesDir,
  workspaceDir,
} from "./obs-runtime.mjs"

// Builds the Node-API addon (`alloy-desktop-native`) the Electron main process
// loads and stages it as resources/native/alloy-desktop.node. Packaged builds
// ship that folder as an extra resource.

const release = process.argv.includes("--release")
const targetTriple = process.env.CARGO_BUILD_TARGET

const cargoArgs = [
  "build",
  "--manifest-path",
  join(workspaceDir, "Cargo.toml"),
  "--package",
  "alloy-desktop-native",
  "--locked",
]
if (release) cargoArgs.push("--release")
if (targetTriple) cargoArgs.push("--target", targetTriple)

const cargo = spawnSync("cargo", cargoArgs, { stdio: "inherit" })
if (cargo.error) {
  console.error(`Failed to run cargo: ${cargo.error.message}`)
  process.exit(1)
}
if (cargo.status !== 0) process.exit(cargo.status ?? 1)

const targetRoot = resolve(
  process.env.CARGO_TARGET_DIR ?? join(workspaceDir, "target"),
)
const profileDir = release ? "release" : "debug"
const buildDir = targetTriple
  ? join(targetRoot, targetTriple, profileDir)
  : join(targetRoot, profileDir)
const library =
  {
    win32: "alloy_desktop_native.dll",
    darwin: "liballoy_desktop_native.dylib",
  }[process.platform] ?? "liballoy_desktop_native.so"
const built = join(buildDir, library)
if (!existsSync(built)) {
  console.error(`Addon build finished, but ${built} was not found.`)
  process.exit(1)
}

const stagedDir = join(resourcesDir, "native")
mkdirSync(stagedDir, { recursive: true })
copyFileIfChanged(built, join(stagedDir, "alloy-desktop.node"))
console.log(`Staged the ${profileDir} desktop addon.`)
