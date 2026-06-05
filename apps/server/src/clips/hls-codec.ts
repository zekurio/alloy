/**
 * Derive an RFC 6381 `CODECS` value from an fMP4 initialization segment.
 *
 * The HLS master playlist must advertise the *actual* codec profile and level
 * so the browser's `MediaSource.isTypeSupported()` neither rejects a playable
 * rendition nor accepts an unplayable one. Those values depend on the encoder,
 * the resolution and even the frame content, so hardcoding them is wrong (e.g.
 * a libx264 High@4.1 stream announced as Baseline@3.0). We read them straight
 * from the `avcC`/`hvcC`/`av1C` config records ffmpeg wrote into the init
 * segment, and detect whether an audio track is present so silent clips do not
 * advertise an AAC track that never produces samples.
 */

interface Box {
  type: string
  /** Offset of the box payload (after the size+type header). */
  start: number
  /** Offset one past the end of the box. */
  end: number
}

/** ISO-BMFF visual sample entries carry 78 bytes of fixed fields before their
 *  child boxes (6 reserved + 2 data ref + 16 predefined + 64 visual). */
const VISUAL_SAMPLE_ENTRY_HEADER = 78

function readUint32(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] ?? 0) * 0x1000000 +
      ((buf[offset + 1] ?? 0) << 16) +
      ((buf[offset + 2] ?? 0) << 8) +
      (buf[offset + 3] ?? 0)) >>>
    0
  )
}

function* iterBoxes(
  buf: Uint8Array,
  start: number,
  end: number,
): Generator<Box> {
  let i = start
  while (i + 8 <= end) {
    let size = readUint32(buf, i)
    let header = 8
    if (size === 1) {
      // 64-bit largesize; init segments never exceed 32 bits, so the high word
      // is zero and the low word is enough.
      size = readUint32(buf, i + 12)
      header = 16
    } else if (size === 0) {
      size = end - i
    }
    if (size < header || i + size > end) return
    const type = String.fromCharCode(
      buf[i + 4] ?? 0,
      buf[i + 5] ?? 0,
      buf[i + 6] ?? 0,
      buf[i + 7] ?? 0,
    )
    yield { type, start: i + header, end: i + size }
    i += size
  }
}

function findBox(
  buf: Uint8Array,
  path: readonly string[],
  start: number,
  end: number,
): Box | null {
  let found: Box | null = null
  let s = start
  let e = end
  for (const want of path) {
    found = null
    for (const box of iterBoxes(buf, s, e)) {
      if (box.type === want) {
        found = box
        break
      }
    }
    if (!found) return null
    s = found.start
    e = found.end
  }
  return found
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, "0").toUpperCase()
}

/** Reverse the 32 bits of `value`, as required for the HEVC compatibility flags
 *  in an RFC 6381 codec string. */
function reverseBits32(value: number): number {
  let v = value >>> 0
  let r = 0
  for (let i = 0; i < 32; i++) {
    r = ((r << 1) | (v & 1)) >>> 0
    v >>>= 1
  }
  return r >>> 0
}

function avcCodec(entryType: string, cfg: Uint8Array): string | null {
  // avcC: configurationVersion, AVCProfileIndication, profile_compatibility,
  // AVCLevelIndication, ...
  if (cfg.length < 4) return null
  return `${entryType}.${hex2(cfg[1] ?? 0)}${hex2(cfg[2] ?? 0)}${hex2(cfg[3] ?? 0)}`
}

function hevcCodec(entryType: string, cfg: Uint8Array): string | null {
  // hvcC: version | (profile_space<<6 | tier<<5 | profile_idc) | compat(4) |
  // constraint(6) | level(1)
  if (cfg.length < 13) return null
  const profileSpace = ((cfg[1] ?? 0) >> 6) & 0x3
  const tierFlag = ((cfg[1] ?? 0) >> 5) & 0x1
  const profileIdc = (cfg[1] ?? 0) & 0x1f
  const compat = reverseBits32(readUint32(cfg, 2))
  const constraint = cfg.subarray(6, 12)
  const level = cfg[12] ?? 0

  const space = ["", "A", "B", "C"][profileSpace] ?? ""
  let lastNonZero = constraint.length - 1
  while (lastNonZero >= 0 && constraint[lastNonZero] === 0) lastNonZero--
  let constraintStr = ""
  for (let i = 0; i <= lastNonZero; i++) {
    constraintStr += `.${hex2(constraint[i] ?? 0)}`
  }
  return `${entryType}.${space}${profileIdc}.${compat.toString(16).toUpperCase()}.${
    tierFlag ? "H" : "L"
  }${level}${constraintStr}`
}

function av1Codec(cfg: Uint8Array): string | null {
  // av1C: marker/version | seq_profile(3)+seq_level_idx_0(5) |
  // seq_tier_0(1)+high_bitdepth(1)+twelve_bit(1)+...
  if (cfg.length < 3) return null
  const seqProfile = ((cfg[1] ?? 0) >> 5) & 0x7
  const seqLevel = (cfg[1] ?? 0) & 0x1f
  const seqTier = ((cfg[2] ?? 0) >> 7) & 0x1
  const highBitdepth = ((cfg[2] ?? 0) >> 6) & 0x1
  const twelveBit = ((cfg[2] ?? 0) >> 5) & 0x1
  const depth = highBitdepth && twelveBit ? 12 : highBitdepth ? 10 : 8
  const level = seqLevel.toString().padStart(2, "0")
  return `av01.${seqProfile}.${level}${seqTier ? "H" : "M"}.${depth.toString().padStart(2, "0")}`
}

function videoCodecFromEntry(buf: Uint8Array, entry: Box): string | null {
  const childStart = entry.start + VISUAL_SAMPLE_ENTRY_HEADER
  if (childStart > entry.end) return null
  if (entry.type === "avc1" || entry.type === "avc3") {
    const cfg = findBox(buf, ["avcC"], childStart, entry.end)
    return cfg ? avcCodec(entry.type, buf.subarray(cfg.start, cfg.end)) : null
  }
  if (entry.type === "hvc1" || entry.type === "hev1") {
    const cfg = findBox(buf, ["hvcC"], childStart, entry.end)
    return cfg ? hevcCodec(entry.type, buf.subarray(cfg.start, cfg.end)) : null
  }
  if (entry.type === "av01") {
    const cfg = findBox(buf, ["av1C"], childStart, entry.end)
    return cfg ? av1Codec(buf.subarray(cfg.start, cfg.end)) : null
  }
  return null
}

/**
 * Parse the `CODECS` attribute value (video, plus `,mp4a.40.2` when an audio
 * track exists) from an fMP4 init segment, or `null` if no video track can be
 * read. We always transcode AAC-LC, so a detected `mp4a` track maps to the
 * fixed `mp4a.40.2` without decoding the `esds`.
 */
export function parseHlsCodecsFromInit(init: Uint8Array): string | null {
  const moov = findBox(init, ["moov"], 0, init.length)
  if (!moov) return null

  let video: string | null = null
  let hasAudio = false
  for (const trak of iterBoxes(init, moov.start, moov.end)) {
    if (trak.type !== "trak") continue
    const stsd = findBox(
      init,
      ["mdia", "minf", "stbl", "stsd"],
      trak.start,
      trak.end,
    )
    if (!stsd) continue
    // stsd: 4 bytes version/flags + 4 bytes entry_count, then sample entries.
    for (const entry of iterBoxes(init, stsd.start + 8, stsd.end)) {
      if (!video) {
        const codec = videoCodecFromEntry(init, entry)
        if (codec) {
          video = codec
          continue
        }
      }
      if (entry.type === "mp4a") hasAudio = true
    }
  }

  if (!video) return null
  return hasAudio ? `${video},mp4a.40.2` : video
}
