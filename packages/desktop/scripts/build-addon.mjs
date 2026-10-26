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
// Electron brings no Visual C++ runtime, so on Windows the addon links the C
// runtime statically, as Node addons usually do. The different flags build
// into their own target folder, so the recorder and the tests keep theirs.
const staticRuntime = (
  targetTriple ?? (process.platform === "win32" ? "windows-msvc" : "")
).includes("windows-msvc")
const targetRoot = join(
  resolve(process.env.CARGO_TARGET_DIR ?? join(workspaceDir, "target")),
  ...(staticRuntime ? ["static-crt"] : []),
)

const cargoArgs = [
  "build",
  "--manifest-path",
  join(workspaceDir, "Cargo.toml"),
  "--package",
  "alloy-desktop-native",
  "--locked",
  "--target-dir",
  targetRoot,
]
if (release) cargoArgs.push("--release")
if (targetTriple) cargoArgs.push("--target", targetTriple)

const env = { ...process.env }
if (staticRuntime) {
  env.RUSTFLAGS = [process.env.RUSTFLAGS, "-C target-feature=+crt-static"]
    .filter(Boolean)
    .join(" ")
}
const cargo = spawnSync("cargo", cargoArgs, { stdio: "inherit", env })
if (cargo.error) {
  console.error(`Failed to run cargo: ${cargo.error.message}`)
  process.exit(1)
}
if (cargo.status !== 0) process.exit(cargo.status ?? 1)

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
