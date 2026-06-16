/* eslint-disable no-console */

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs"
import { join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

import {
  distDir,
  normalizeObsRuntimeDir,
  obsResourcesDir,
  pruneObsRuntime,
  stageObsRuntime,
} from "./obs-runtime.mjs"

const obsRepoApi = "https://api.github.com/repos/obsproject/obs-studio"
const version =
  optionValue("--version") ?? process.env.ALLOY_OBS_VERSION ?? "latest"
const force = process.argv.includes("--force")

if (process.platform !== "win32") {
  console.error("OBS runtime installation is only supported on Windows.")
  process.exit(1)
}

if (!force && normalizeObsRuntimeDir(obsResourcesDir)) {
  console.log(`OBS runtime is already staged in ${obsResourcesDir}`)
  console.log("Pass --force to replace it.")
  process.exit(0)
}

const release = await fetchRelease(version)
const asset = release.assets.find((asset) =>
  /^OBS-Studio-.+-Windows-x64\.zip$/i.test(asset.name),
)

if (!asset) {
  console.error(
    `OBS ${release.tag_name} does not expose a Windows x64 portable ZIP asset.`,
  )
  process.exit(1)
}

const sha256 = releaseAssetSha256(release, asset)
const workDir = join(distDir, "obs-runtime-download")
const zipPath = join(workDir, asset.name)
const extractDir = join(workDir, "extract")

rmSync(workDir, { recursive: true, force: true })
mkdirSync(extractDir, { recursive: true })

console.log(`Downloading ${asset.name} from OBS ${release.tag_name}...`)
await downloadAsset(asset.browser_download_url, zipPath)

if (sha256) {
  const actual = fileSha256(zipPath)
  if (actual !== sha256) {
    console.error(
      [
        `OBS runtime checksum mismatch for ${asset.name}.`,
        `Expected: ${sha256}`,
        `Actual:   ${actual}`,
      ].join("\n"),
    )
    process.exit(1)
  }
} else {
  console.warn("OBS release did not include a SHA-256 digest for this asset.")
}

console.log("Extracting OBS portable runtime...")
extractZip(zipPath, extractDir)

const runtimeRoot = findObsRuntimeRoot(extractDir)
if (!runtimeRoot) {
  console.error(`Extracted OBS archive does not contain obs.dll: ${extractDir}`)
  process.exit(1)
}

stageObsRuntime(runtimeRoot)
pruneObsRuntime()
rmSync(workDir, { recursive: true, force: true })

console.log(`Staged OBS runtime in ${obsResourcesDir}`)

async function fetchRelease(requestedVersion) {
  const endpoint =
    requestedVersion === "latest"
      ? `${obsRepoApi}/releases/latest`
      : `${obsRepoApi}/releases/tags/${encodeURIComponent(requestedVersion)}`
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "alloy-recorder-obs-runtime-installer",
    },
  })

  if (!response.ok) {
    console.error(
      `Failed to resolve OBS release ${requestedVersion}: ${response.status} ${response.statusText}`,
    )
    process.exit(1)
  }

  return response.json()
}

async function downloadAsset(url, destination) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "alloy-recorder-obs-runtime-installer",
    },
  })

  if (!response.ok || !response.body) {
    console.error(
      `Failed to download OBS runtime: ${response.status} ${response.statusText}`,
    )
    process.exit(1)
  }

  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination),
  )
}

function extractZip(zipFile, destination) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "& { param($zipFile, $destination) Expand-Archive -LiteralPath $zipFile -DestinationPath $destination -Force }",
      zipFile,
      destination,
    ],
    { stdio: "inherit" },
  )

  if (result.error) {
    console.error(
      `Failed to run PowerShell Expand-Archive: ${result.error.message}`,
    )
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function findObsRuntimeRoot(directory, depth = 0) {
  const runtimeRoot = normalizeObsRuntimeDir(directory)
  if (runtimeRoot) return runtimeRoot
  if (depth >= 4 || !existsSync(directory)) return null

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const nested = findObsRuntimeRoot(join(directory, entry.name), depth + 1)
    if (nested) return nested
  }

  return null
}

function releaseAssetSha256(release, asset) {
  if (typeof asset.digest === "string") {
    const digest = asset.digest.match(/^sha256:([a-f0-9]{64})$/i)
    if (digest) return digest[1].toLowerCase()
  }

  if (typeof release.body !== "string") return null
  const bodyDigest = release.body.match(
    new RegExp(`${escapeRegex(asset.name)}[^a-f0-9]+([a-f0-9]{64})`, "i"),
  )
  return bodyDigest?.[1]?.toLowerCase() ?? null
}

function fileSha256(path) {
  const hash = createHash("sha256")
  hash.update(readFileSync(path))
  return hash.digest("hex")
}

function optionValue(name) {
  const exactIndex = process.argv.indexOf(name)
  if (exactIndex !== -1) return process.argv[exactIndex + 1] ?? null

  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`))
  return prefixed?.slice(name.length + 1) ?? null
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
