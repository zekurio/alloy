import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const recorderDir = fileURLToPath(new URL("../", import.meta.url))
export const distDir = join(recorderDir, "dist")
export const sidecarResourcesDir = join(distDir, "sidecar")
export const obsResourcesDir = join(distDir, "obs-runtime")

const obsHelperExecutables = [
  "obs-ffmpeg-mux.exe",
  "obs-amf-test.exe",
  "obs-nvenc-test.exe",
  "obs-qsv-test.exe",
]

export function stageObsRuntime(runtimeRoot) {
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

export function stageObsHelpers() {
  for (const helper of obsHelperExecutables) {
    const helperPath = join(obsResourcesDir, "bin", "64bit", helper)
    if (existsSync(helperPath)) {
      copyFileIfChanged(helperPath, join(sidecarResourcesDir, helper))
    }
  }
}

export function pruneObsRuntime() {
  // Modules loaded by the sidecar (see platform_modules in sidecar_obs_platform.rs).
  const keptObsModules = [
    "obs-ffmpeg",
    "obs-outputs",
    "obs-x264",
    "obs-nvenc",
    "obs-qsv11",
    "coreaudio-encoder",
    "win-capture",
    "win-wasapi",
  ]

  // bin/64bit allowlist: libobs + graphics modules, runtime deps of the kept
  // plugin modules (verified against their import tables), and helper exes.
  const keptBinFilePatterns = [
    /^obs\.dll$/,
    /^libobs-d3d11\.dll$/,
    /^libobs-winrt\.dll$/,
    /^(avcodec|avdevice|avfilter|avformat|avutil|swresample|swscale)-\d+\.dll$/,
    /^libx264-\d+\.dll$/,
    /^w32-pthreads\.dll$/,
    /^zlib\.dll$/,
    /^libcurl\.dll$/,
    /^librist\.dll$/,
    /^srt\.dll$/,
    /^obs-ffmpeg-mux\.exe$/,
    /^obs-amf-test\.exe$/,
    /^obs-nvenc-test\.exe$/,
    /^obs-qsv-test\.exe$/,
  ]

  const keptBinDirs = new Set(["win-capture"])

  const binDir = join(obsResourcesDir, "bin", "64bit")
  if (!hasObsDll(binDir)) return

  const beforeBytes = directorySize(obsResourcesDir)

  // Top level: only bin, data, obs-plugins (and the .gitkeep marker).
  pruneDirectory(obsResourcesDir, (entry) =>
    ["bin", "data", "obs-plugins", ".gitkeep"].includes(
      entry.name.toLowerCase(),
    ),
  )

  pruneDirectory(join(obsResourcesDir, "bin"), (entry) =>
    ["64bit"].includes(entry.name.toLowerCase()),
  )

  pruneDirectory(binDir, (entry) => {
    const name = entry.name.toLowerCase()
    if (entry.isDirectory()) return keptBinDirs.has(name)
    return keptBinFilePatterns.some((pattern) => pattern.test(name))
  })

  // Plugin binaries: only the modules the sidecar loads, without debug symbols.
  pruneDirectory(join(obsResourcesDir, "obs-plugins"), (entry) =>
    ["64bit"].includes(entry.name.toLowerCase()),
  )
  pruneDirectory(join(obsResourcesDir, "obs-plugins", "64bit"), (entry) => {
    if (entry.isDirectory()) return false
    return keptObsModules.includes(
      entry.name.toLowerCase().replace(/\.dll$/, ""),
    )
  })

  // Plugin data: libobs effects plus the kept modules' locale/assets.
  pruneDirectory(join(obsResourcesDir, "data"), (entry) =>
    ["libobs", "obs-plugins"].includes(entry.name.toLowerCase()),
  )
  pruneDirectory(join(obsResourcesDir, "data", "obs-plugins"), (entry) =>
    keptObsModules.includes(entry.name.toLowerCase()),
  )

  const afterBytes = directorySize(obsResourcesDir)
  process.stdout.write(
    `Pruned OBS runtime: ${formatMegabytes(beforeBytes)} -> ${formatMegabytes(afterBytes)}`,
  )
  process.stdout.write("\n")
}

export function normalizeObsRuntimeDir(candidate) {
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

export function hasObsDll(candidate) {
  return existsSync(join(candidate, "obs.dll"))
}

export function copyFileIfChanged(source, destination) {
  if (existsSync(destination) && sameFileContents(source, destination)) {
    return
  }

  cpSync(source, destination)
}

function pruneDirectory(directory, keep) {
  if (!existsSync(directory)) return

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!keep(entry)) {
      rmSync(join(directory, entry.name), { recursive: true, force: true })
    }
  }
}

function directorySize(directory) {
  let total = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) total += directorySize(entryPath)
    else if (entry.isFile()) total += statSync(entryPath).size
  }
  return total
}

function formatMegabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function sameFileContents(left, right) {
  try {
    const leftBytes = readFileSync(left)
    const rightBytes = readFileSync(right)
    return (
      leftBytes.length === rightBytes.length && leftBytes.equals(rightBytes)
    )
  } catch {
    return false
  }
}

function basenameInsensitive(path) {
  return basename(path).toLowerCase()
}
