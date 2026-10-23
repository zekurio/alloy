import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { download, expandArchive, fileSha256 } from "./archive.mjs"
import {
  cacheDir,
  normalizeObsRuntimeDir,
  obsResourcesDir,
  pruneObsRuntime,
  stageObsRuntime,
} from "./obs-runtime.mjs"

const obsRepoApi = "https://api.github.com/repos/obsproject/obs-studio"
const userAgent = "alloy-agent-obs-runtime-installer"

// The default OBS release, which CI and release builds stage, and the SHA-256
// of its portable ZIP, pinned like FFmpeg in prepare-native.mjs. The workflows
// key their runtime cache on this file's hash, so bumping the pin refreshes the
// cache too. Other versions and "latest" must carry a digest in their release
// metadata.
const pinnedVersion = "32.1.2"
const pinnedZipSha256 =
  "8d97e4563bd8d22d03e63042aa7dccede1d555c9bd35ce8a9e5019b0d0201bf6"

const version =
  optionValue("--version") ?? process.env.ALLOY_OBS_VERSION ?? pinnedVersion
const force = process.argv.includes("--force")
const allowUnverified = process.env.ALLOY_OBS_ALLOW_UNVERIFIED === "1"

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

const pinned = release.tag_name === pinnedVersion ? pinnedZipSha256 : null
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
await download(asset.browser_download_url, zipPath, {
  headers: { "User-Agent": userAgent },
})

if (sha256) {
  const actual = await fileSha256(zipPath)
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
expandArchive(zipPath, extractDir)

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
      "User-Agent": userAgent,
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
