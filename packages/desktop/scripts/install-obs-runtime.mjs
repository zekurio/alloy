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
  cacheDir,
  normalizeObsRuntimeDir,
  obsResourcesDir,
  pruneObsRuntime,
  stageObsRuntime,
} from "./obs-runtime.mjs"

const obsRepoApi = "https://api.github.com/repos/obsproject/obs-studio"
const version =
  optionValue("--version") ?? process.env.ALLOY_OBS_VERSION ?? "latest"
const force = process.argv.includes("--force")
const allowUnverified = process.env.ALLOY_OBS_ALLOW_UNVERIFIED === "1"

// SHA-256 of the portable ZIP per pinned OBS release, like FFmpeg in
// prepare-native.mjs. Add an entry when CI moves to a new --version. Other
// versions (and "latest") must carry a digest in the release metadata.
const pinnedSha256 = {
  "32.1.2": {
    "OBS-Studio-32.1.2-Windows-x64.zip":
      "8d97e4563bd8d22d03e63042aa7dccede1d555c9bd35ce8a9e5019b0d0201bf6",
  },
}

if (process.platform !== "win32") {
  console.error("OBS runtime installation is only supported on Windows.")
  process.exit(1)
}

if (!force && normalizeObsRuntimeDir(obsResourcesDir)) {
  writeOutput(`OBS runtime is already staged in ${obsResourcesDir}`)
  writeOutput("Pass --force to replace it.")
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

const pinned = pinnedSha256[release.tag_name]?.[asset.name] ?? null
const published = releaseAssetSha256(release, asset)
if (pinned && published && pinned !== published) {
  console.error(
    [
      `OBS release digest for ${asset.name} does not match the pinned SHA-256.`,
      `Pinned:    ${pinned}`,
      `Published: ${published}`,
    ].join("\n"),
  )
  process.exit(1)
}
const sha256 = pinned ?? published
if (!sha256 && !allowUnverified) {
  console.error(
    [
      `No SHA-256 digest is available for ${asset.name} (OBS ${release.tag_name}).`,
      "Pin it in install-obs-runtime.mjs, or set ALLOY_OBS_ALLOW_UNVERIFIED=1 to",
      "install without verification (local development only).",
    ].join("\n"),
  )
  process.exit(1)
}
const workDir = join(cacheDir, "obs-runtime-download")
const zipPath = join(workDir, asset.name)
const extractDir = join(workDir, "extract")

rmSync(workDir, { recursive: true, force: true })
mkdirSync(extractDir, { recursive: true })

writeOutput(`Downloading ${asset.name} from OBS ${release.tag_name}...`)
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
  console.warn(
    "ALLOY_OBS_ALLOW_UNVERIFIED=1: installing OBS runtime without a SHA-256 check.",
  )
}

writeOutput("Extracting OBS portable runtime...")
extractZip(zipPath, extractDir)

const runtimeRoot = findObsRuntimeRoot(extractDir)
if (!runtimeRoot) {
  console.error(`Extracted OBS archive does not contain obs.dll: ${extractDir}`)
  process.exit(1)
}

stageObsRuntime(runtimeRoot)
pruneObsRuntime()
rmSync(workDir, { recursive: true, force: true })

writeOutput(`Staged OBS runtime in ${obsResourcesDir}`)

async function fetchRelease(requestedVersion) {
  const endpoint =
    requestedVersion === "latest"
      ? `${obsRepoApi}/releases/latest`
      : `${obsRepoApi}/releases/tags/${encodeURIComponent(requestedVersion)}`
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "alloy-agent-obs-runtime-installer",
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
      "User-Agent": "alloy-agent-obs-runtime-installer",
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
  if (asset.digest?.constructor === String) {
    const digest = asset.digest.match(/^sha256:([a-f0-9]{64})$/i)
    if (digest) return digest[1].toLowerCase()
  }

  if (release.body?.constructor !== String) return null
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

function writeOutput(message) {
  process.stdout.write(`${message}\n`)
}
