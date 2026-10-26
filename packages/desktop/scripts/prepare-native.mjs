import { spawnSync } from "node:child_process"
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
import { fileURLToPath } from "node:url"

import { download, expandArchive, fileSha256 } from "./archive.mjs"

const packageDir = fileURLToPath(new URL("..", import.meta.url))
const resourcesDir = join(packageDir, "resources", "ffmpeg")
const version = "8.1.2"
const archiveName = `ffmpeg-${version}-essentials_build.zip`
// Published by the build provider at the matching .zip.sha256 URL.
const checksum =
  "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec"

if (process.platform !== "win32" && process.platform !== "linux") {
  console.log("Recorder and FFmpeg staging skipped on this platform.")
  process.exit(0)
}

const windows = process.platform === "win32"
const release = process.argv.includes("--release")
const recorder = spawnSync(
  process.execPath,
  [
    resolve(packageDir, "scripts/build-agent.mjs"),
    ...(release ? ["--release"] : []),
    ...(release && windows ? ["--require-obs-runtime"] : []),
  ],
  { stdio: "inherit" },
)
if (recorder.error) throw recorder.error
if (recorder.status !== 0) process.exit(recorder.status ?? 1)

// Linux uses the system's FFmpeg; packages put it on the app's PATH. Its OBS
// comes from ALLOY_OBS_RUNTIME_DIR or the system, not from staging.
if (!windows) {
  await mkdir(resourcesDir, { recursive: true })
  process.exit(0)
}

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

if ((await fileSha256(archive)) !== checksum) {
  await download(
    `https://www.gyan.dev/ffmpeg/builds/packages/${archiveName}`,
    archive,
    { signal: AbortSignal.timeout(300_000) },
  )
  if ((await fileSha256(archive)) !== checksum) {
    await rm(archive, { force: true })
    throw new Error("FFmpeg archive checksum does not match.")
  }
}

await rm(unpacked, { recursive: true, force: true })
expandArchive(archive, unpacked)
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
