/* eslint-disable no-console */

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { join, resolve } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"

const packageDir = fileURLToPath(new URL("..", import.meta.url))
const resourcesDir = join(packageDir, "resources", "ffmpeg")
const version = "8.1.2"
const archiveName = `ffmpeg-${version}-essentials_build.zip`
// Published by the build provider at the matching .zip.sha256 URL.
const checksum =
  "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec"

if (process.platform !== "win32") {
  console.log("Windows recorder and FFmpeg staging skipped on this platform.")
  process.exit(0)
}

const release = process.argv.includes("--release")
const recorder = spawnSync(
  process.execPath,
  [
    resolve(packageDir, "../recorder/scripts/build.mjs"),
    ...(release ? ["--release", "--require-obs-runtime"] : []),
  ],
  { stdio: "inherit" },
)
if (recorder.error) throw recorder.error
if (recorder.status !== 0) process.exit(recorder.status ?? 1)

const marker = join(resourcesDir, ".build-checksum")
const staged = await Promise.all([
  readFile(marker, "utf8").catch(() => ""),
  stat(join(resourcesDir, "ffmpeg.exe")).catch(() => null),
  stat(join(resourcesDir, "ffprobe.exe")).catch(() => null),
])
if (staged[0] === checksum && staged[1]?.isFile() && staged[2]?.isFile()) {
  console.log(`Using staged FFmpeg ${version}.`)
  process.exit(0)
}

const cacheDir = join(packageDir, ".cache", "ffmpeg", version)
const archive = join(cacheDir, archiveName)
const unpacked = join(cacheDir, "unpacked")
await mkdir(cacheDir, { recursive: true })

if (!(await validArchive(archive))) {
  const response = await fetch(
    `https://www.gyan.dev/ffmpeg/builds/packages/${archiveName}`,
    { signal: AbortSignal.timeout(300_000) },
  )
  if (!response.ok || !response.body) {
    throw new Error(`FFmpeg download failed: HTTP ${response.status}.`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
  if (!(await validArchive(archive))) {
    await rm(archive, { force: true })
    throw new Error("FFmpeg archive checksum does not match.")
  }
}

await rm(unpacked, { recursive: true, force: true })
const extract = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:ALLOY_FFMPEG_ARCHIVE -DestinationPath $env:ALLOY_FFMPEG_DESTINATION",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ALLOY_FFMPEG_ARCHIVE: archive,
      ALLOY_FFMPEG_DESTINATION: unpacked,
    },
  },
)
if (extract.error) throw extract.error
if (extract.status !== 0) throw new Error("Could not extract FFmpeg.")
const roots = await readdir(unpacked)
if (roots.length !== 1) throw new Error("Unexpected FFmpeg archive layout.")
const source = join(unpacked, roots[0])
await mkdir(resourcesDir, { recursive: true })
for (const executable of ["ffmpeg.exe", "ffprobe.exe"]) {
  const path = join(source, "bin", executable)
  if (!(await stat(path)).isFile()) throw new Error(`Missing ${executable}.`)
  await cp(path, join(resourcesDir, executable))
}
// Keep the upstream license and build notes beside the distributed binaries.
for (const name of await readdir(source)) {
  if (/^(license|readme)/i.test(name)) {
    await cp(join(source, name), join(resourcesDir, name), { recursive: true })
  }
}
await writeFile(marker, checksum)
console.log(`Staged FFmpeg ${version}.`)

async function validArchive(path) {
  const hash = createHash("sha256")
  try {
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return hash.digest("hex") === checksum
  } catch (cause) {
    if (cause.code === "ENOENT") return false
    throw cause
  }
}
