import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

// Download, verify, and unpack the pinned OBS and FFmpeg ZIPs. Both
// installers stream to disk and hash in chunks, so a large archive never sits
// in memory.

/** Streams `url` to `destination`. `init` is passed to `fetch`. */
export async function download(url, destination, init = {}) {
  const response = await fetch(url, init)
  if (!response.ok || !response.body) {
    throw new Error(
      `Download of ${url} failed: HTTP ${response.status} ${response.statusText}`,
    )
  }
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination),
  )
}

/** The file's SHA-256 as lowercase hex, or null when it does not exist. */
export async function fileSha256(path) {
  const hash = createHash("sha256")
  try {
    for await (const chunk of createReadStream(path)) hash.update(chunk)
  } catch (cause) {
    if (cause.code === "ENOENT") return null
    throw cause
  }
  return hash.digest("hex")
}

/** Unpacks a ZIP with PowerShell's Expand-Archive, replacing existing files. */
export function expandArchive(archive, destination) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      // Expand-Archive lives in a script module, which a Restricted policy
      // would refuse to load.
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:ALLOY_ARCHIVE -DestinationPath $env:ALLOY_ARCHIVE_DESTINATION -Force",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        ALLOY_ARCHIVE: archive,
        ALLOY_ARCHIVE_DESTINATION: destination,
      },
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Could not extract ${archive}.`)
}
