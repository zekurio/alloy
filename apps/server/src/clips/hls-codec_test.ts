import assert from "node:assert/strict"
import { test } from "node:test"

import { parseHlsCodecsFromInit } from "./hls-codec"

// ISO-BMFF box helpers — build the minimal moov tree the parser walks.
function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length)
  new DataView(out.buffer).setUint32(0, out.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(payload, 8)
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function hex(value: string): Uint8Array {
  const out = new Uint8Array(value.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function stsd(entry: Uint8Array): Uint8Array {
  const header = new Uint8Array(8)
  new DataView(header.buffer).setUint32(4, 1) // entry_count = 1
  return box("stsd", concat(header, entry))
}

function videoTrak(
  entryType: string,
  configType: string,
  config: Uint8Array,
): Uint8Array {
  // 78 bytes of VisualSampleEntry fields precede the config box.
  const entry = box(
    entryType,
    concat(new Uint8Array(78), box(configType, config)),
  )
  return box("trak", box("mdia", box("minf", box("stbl", stsd(entry)))))
}

function audioTrak(): Uint8Array {
  const entry = box("mp4a", new Uint8Array(28))
  return box("trak", box("mdia", box("minf", box("stbl", stsd(entry)))))
}

function initSegment(...traks: Uint8Array[]): Uint8Array {
  return concat(box("ftyp", new Uint8Array(16)), box("moov", concat(...traks)))
}

// Config records below are real ffmpeg fMP4 output (libx264 High@4.1,
// libx265 Main@3.1, libsvtav1) trimmed to the bytes the codec string needs.
const AVC_HIGH_41 = hex("01640029")
const HVC_MAIN_31 = hex("0101600000009000000000005d")
const AV1_MAIN = hex("81050d")

test("parseHlsCodecsFromInit derives H.264 High@4.1 with audio", () => {
  const init = initSegment(videoTrak("avc1", "avcC", AVC_HIGH_41), audioTrak())
  assert.equal(parseHlsCodecsFromInit(init), "avc1.640029,mp4a.40.2")
})

test("parseHlsCodecsFromInit derives HEVC with reversed compat flags", () => {
  const init = initSegment(videoTrak("hvc1", "hvcC", HVC_MAIN_31), audioTrak())
  assert.equal(parseHlsCodecsFromInit(init), "hvc1.1.6.L93.90,mp4a.40.2")
})

test("parseHlsCodecsFromInit derives AV1 profile/level/depth", () => {
  const init = initSegment(videoTrak("av01", "av1C", AV1_MAIN), audioTrak())
  assert.equal(parseHlsCodecsFromInit(init), "av01.0.05M.08,mp4a.40.2")
})

test("parseHlsCodecsFromInit omits audio for silent clips", () => {
  const init = initSegment(videoTrak("avc1", "avcC", AVC_HIGH_41))
  assert.equal(parseHlsCodecsFromInit(init), "avc1.640029")
})

test("parseHlsCodecsFromInit returns null without a video track", () => {
  assert.equal(parseHlsCodecsFromInit(initSegment(audioTrak())), null)
  assert.equal(parseHlsCodecsFromInit(new Uint8Array(0)), null)
})
