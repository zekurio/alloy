import { buildHlsMasterPlaylist } from "./clips-helpers"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function hlsVariant(
  id: string,
  height: number,
  streamInf: string,
): {
  id: string
  height: number
  hls: { playlist: string; streamInf: string }
} {
  return { id, height, hls: { playlist: "#EXTM3U\n", streamInf } }
}

Deno.test("buildHlsMasterPlaylist returns null when no variant has HLS", () => {
  const master = buildHlsMasterPlaylist([
    { id: "720p", height: 720, hls: undefined },
  ])
  assert(master === null, "expected null for progressive-only variants")
})

Deno.test("buildHlsMasterPlaylist orders renditions highest-resolution first", () => {
  const master = buildHlsMasterPlaylist([
    hlsVariant("480p", 480, "BANDWIDTH=800000,RESOLUTION=854x480"),
    hlsVariant("1080p", 1080, "BANDWIDTH=4000000,RESOLUTION=1920x1080"),
    hlsVariant("720p", 720, "BANDWIDTH=2000000,RESOLUTION=1280x720"),
  ])
  assert(master, "expected a master playlist")

  const lines = master.trim().split("\n")
  assert(lines[0] === "#EXTM3U", "must start with #EXTM3U")
  assert(
    lines.includes("#EXT-X-INDEPENDENT-SEGMENTS"),
    "must declare independent segments",
  )

  const uris = lines.filter((line) => line.endsWith("playlist.m3u8"))
  assert(
    uris.join(",") ===
      "1080p/playlist.m3u8,720p/playlist.m3u8,480p/playlist.m3u8",
    `renditions out of order: ${uris.join(",")}`,
  )

  const firstInf = lines.find((line) => line.startsWith("#EXT-X-STREAM-INF:"))
  assert(
    firstInf === "#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=1920x1080",
    `unexpected first STREAM-INF: ${firstInf}`,
  )
})

Deno.test("buildHlsMasterPlaylist percent-encodes rendition ids in URIs", () => {
  const master = buildHlsMasterPlaylist([
    hlsVariant("720p hevc", 720, "BANDWIDTH=2000000"),
  ])
  assert(master, "expected a master playlist")
  assert(
    master.includes("720p%20hevc/playlist.m3u8"),
    `rendition id was not encoded: ${master}`,
  )
})
