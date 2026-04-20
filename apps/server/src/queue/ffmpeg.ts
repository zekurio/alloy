import { spawn } from "node:child_process"

import type { EncoderConfig, HwaccelKind } from "../lib/config-store"
import { env } from "../env"

/**
 * Thin shell-out wrappers around ffmpeg / ffprobe. Three exports:
 *
 *   - `probe`      → ffprobe → { durationMs, width, height, contentType }
 *   - `encode`     → transcode the source into a single H.264/AAC mp4
 *   - `thumbnail`  → grab a single frame at a given offset, scaled
 *
 * No `fluent-ffmpeg` — it's unmaintained and the wrappers we'd use are
 * 5-line shell commands. Direct `spawn` keeps stderr handling explicit
 * (the encode pipe needs it to drive progress reporting).
 *
 * All commands assume `ffmpeg` and `ffprobe` resolve via the env-set
 * binary names; flake.nix's `ffmpeg-headless` provides both.
 */

export interface ProbeResult {
  durationMs: number
  width: number
  height: number
  /** Best-effort MIME from the container. Caller should still trust the
   * stored Content-Type when present. */
  contentType: string
}

/**
 * ffprobe the file and pull the dimensions, duration, and a best-effort
 * content type. Throws on non-zero exit or unparsable output.
 */
export async function probe(srcPath: string): Promise<ProbeResult> {
  // -v error          → only emit fatal errors (we want a clean stdout)
  // -print_format json → machine-readable
  // -show_streams      → per-stream entries (we pick the video stream)
  // -show_format       → container-level duration + format_name
  const { stdout } = await runCapture(env.FFPROBE_BIN, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    srcPath,
  ])

  let parsed: ProbeJson
  try {
    parsed = JSON.parse(stdout) as ProbeJson
  } catch (err) {
    throw new Error(`ffprobe returned unparsable JSON: ${err}`)
  }

  const videoStream = parsed.streams?.find((s) => s.codec_type === "video")
  if (!videoStream) throw new Error("No video stream found")

  // Duration sometimes only appears at the format level (mkv/mp4 with
  // unknown stream duration). Fall back through both.
  const durationSec = Number.parseFloat(
    videoStream.duration ?? parsed.format?.duration ?? "0"
  )
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("Could not determine duration from probe output")
  }

  const width = Number.parseInt(String(videoStream.width ?? 0), 10)
  const height = Number.parseInt(String(videoStream.height ?? 0), 10)
  if (!width || !height) throw new Error("Missing width/height in probe output")

  return {
    durationMs: Math.round(durationSec * 1000),
    width,
    height,
    contentType: contentTypeForFormatName(parsed.format?.format_name ?? ""),
  }
}

interface ProbeJson {
  streams?: Array<{
    codec_type?: string
    width?: number | string
    height?: number | string
    duration?: string
  }>
  format?: {
    format_name?: string
    duration?: string
  }
}

function contentTypeForFormatName(name: string): string {
  // Container detection from ffprobe's `format_name` (comma-separated).
  const parts = name.split(",").map((s) => s.trim())
  if (parts.includes("mp4") || parts.includes("mov")) return "video/mp4"
  if (parts.includes("matroska")) return "video/x-matroska"
  if (parts.includes("webm")) return "video/webm"
  return "application/octet-stream"
}

/**
 * Encode the source into a single web-friendly mp4 rendition. The
 * encoder backend is driven by `opts.config.hwaccel`:
 *
 *   - `software` → libx264/libx265 with CRF
 *   - `nvenc`    → h264_nvenc/hevc_nvenc with VBR + CQ
 *   - `qsv`      → h264_qsv/hevc_qsv with global_quality
 *   - `amf`      → h264_amf/hevc_amf with constant-QP
 *   - `vaapi`    → h264_vaapi/hevc_vaapi on the configured render node
 *
 * `onProgress` receives 0–100 integers as ffmpeg's stderr-progress
 * stream advances. The caller throttles writes; we just emit every
 * parseable line. Output is mp4 with `+faststart` regardless of codec
 * so the browser can begin playback before the full file lands.
 */
export async function encode(
  srcPath: string,
  outPath: string,
  opts: {
    config: EncoderConfig
    targetHeight?: number
    durationMs: number
    onProgress: (pct: number) => void
    /**
     * Optional trim window in milliseconds. When set, ffmpeg seeks to
     * `trimStartMs` before opening the input (`-ss` *before* `-i`, fast
     * keyframe seek) and limits output to `trimEndMs - trimStartMs`
     * (`-t` after `-i`). The output's duration becomes the trim length,
     * not the source length — the caller should record that.
     *
     * `durationMs` above must already reflect the trimmed length so the
     * progress percentage tracks the right denominator.
     */
    trimStartMs?: number | null
    trimEndMs?: number | null
    /**
     * Cancellation — aborting the signal SIGTERMs ffmpeg and rejects the
     * returned promise with an `AbortError`. The caller (the encode
     * worker) uses this to bail out of a clip that's been deleted
     * mid-flight so ffmpeg isn't still writing bytes to disk after the
     * DB row and source file are gone.
     */
    signal?: AbortSignal
  }
): Promise<void> {
  const args = buildEncodeArgs(srcPath, outPath, opts)

  await runWithProgress(
    env.FFMPEG_BIN,
    args,
    (line) => {
      // `out_time_us` is microseconds (newer ffmpeg); `out_time_ms` is the
      // legacy alias and is *also* microseconds despite the name. Either
      // works — divide by 1000 → ms, then by the trimmed duration → pct.
      const m =
        /^out_time_us=(-?\d+)/m.exec(line) ?? /^out_time_ms=(-?\d+)/m.exec(line)
      if (!m) return
      const microseconds = Number.parseInt(m[1] ?? "0", 10)
      if (!Number.isFinite(microseconds) || microseconds < 0) return
      const ms = microseconds / 1000
      const pct = Math.min(
        99,
        Math.max(0, Math.floor((ms / opts.durationMs) * 100))
      )
      opts.onProgress(pct)
    },
    opts.signal
  )
}

/**
 * Construct the ffmpeg command for one encode pass. Split out from
 * `encode()` so it can be unit-tested without spawning ffmpeg, and so
 * the per-hwaccel branching reads as a single switch instead of being
 * tangled into the runner.
 *
 * Argument order matters: input options (hwaccel init, `-ss`) precede
 * `-i`; output options follow it; the codec block sits between the
 * filter chain and the output path.
 */
export function buildEncodeArgs(
  srcPath: string,
  outPath: string,
  opts: {
    config: EncoderConfig
    targetHeight?: number
    trimStartMs?: number | null
    trimEndMs?: number | null
  }
): string[] {
  const { config } = opts
  const hasTrim =
    opts.trimStartMs != null &&
    opts.trimEndMs != null &&
    opts.trimEndMs > opts.trimStartMs
  const trimSeek: string[] = hasTrim
    ? ["-ss", msToFfmpegTimestamp(opts.trimStartMs ?? 0)]
    : []
  const trimDuration: string[] = hasTrim
    ? [
        "-t",
        msToFfmpegTimestamp((opts.trimEndMs ?? 0) - (opts.trimStartMs ?? 0)),
      ]
    : []

  // Input-side device init for hwaccels that need it. VAAPI binds the
  // render node to the input; QSV pre-initialises the device so the
  // hwupload filter has somewhere to copy frames into.
  const deviceInit: string[] = (() => {
    switch (config.hwaccel) {
      case "vaapi":
        return ["-vaapi_device", config.vaapiDevice]
      case "qsv":
        return ["-init_hw_device", "qsv=qsv:hw", "-filter_hw_device", "qsv"]
      default:
        return []
    }
  })()

  const filterChain = buildFilterChain(config, opts.targetHeight)
  const codecArgs = buildCodecArgs(config)
  const audioArgs = [
    "-c:a",
    "aac",
    "-b:a",
    `${config.audioBitrateKbps}k`,
    "-ac",
    "2",
  ]

  return [
    "-hide_banner",
    "-y",
    ...deviceInit,
    ...trimSeek,
    "-i",
    srcPath,
    ...trimDuration,
    "-vf",
    filterChain,
    ...codecArgs,
    "-movflags",
    "+faststart",
    ...audioArgs,
    "-progress",
    "pipe:2",
    "-nostats",
    outPath,
  ]
}

/**
 * Build the `-vf` chain. Software/NVENC/AMF do CPU-side scale + a
 * pixel-format conversion; QSV uses an upload filter so frames cross
 * onto the iGPU; VAAPI does the same with format=nv12 first.
 *
 * `force_original_aspect_ratio=decrease` plus the `-2` width keeps the
 * source's aspect ratio while constraining the long side — small
 * vertical sources stay small instead of being upscaled to fill the
 * target height.
 */
function buildFilterChain(
  config: EncoderConfig,
  targetHeight: number = config.targetHeight
): string {
  const scale = `scale=-2:${targetHeight}:force_original_aspect_ratio=decrease`
  switch (config.hwaccel) {
    case "vaapi":
      // VAAPI scaler runs on the GPU once frames are uploaded in nv12.
      return `format=nv12,hwupload,scale_vaapi=-2:${targetHeight}`
    case "qsv":
      // The QSV scaler runs on the iGPU; uploading first lets us scale
      // and encode without round-tripping back through system memory.
      return `${scale},hwupload=extra_hw_frames=64,format=qsv`
    case "software":
    case "nvenc":
    case "amf":
      // libx264/x265 wants yuv420p; NVENC + AMF accept it directly. The
      // explicit format ensures consistent output regardless of source.
      return `${scale},format=yuv420p`
  }
}

/**
 * Codec/quality flags. The "quality" knob in the config maps onto
 * different rate-control parameters per backend — see the docstring on
 * `EncoderConfigSchema.quality` in `lib/config-store.ts` for the
 * rationale of a unified scale.
 *
 * Profile/level are pinned to "high"/"4.1" for h264 (the most widely
 * decodable browser-friendly tier); hevc uses "main" implicitly which
 * covers all 8-bit 4:2:0 content. Lower profiles save a tiny amount of
 * bytes at the cost of decoder compatibility — not worth it.
 */
function buildCodecArgs(config: EncoderConfig): string[] {
  const q = String(config.quality)
  const preset = config.preset
  const codecName = codecNameFor(config.hwaccel, config.codec)

  switch (config.hwaccel) {
    case "software":
      return [
        "-c:v",
        codecName,
        "-preset",
        preset,
        "-crf",
        q,
        ...(config.codec === "h264"
          ? ["-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p"]
          : ["-pix_fmt", "yuv420p"]),
      ]
    case "nvenc":
      // VBR + CQ gives a quality-targeted encode without a hard bitrate
      // cap; `-b:v 0` lets CQ steer the stream rather than collide with
      // a target bitrate of zero.
      return [
        "-c:v",
        codecName,
        "-preset",
        preset,
        "-rc",
        "vbr",
        "-cq",
        q,
        "-b:v",
        "0",
      ]
    case "qsv":
      return ["-c:v", codecName, "-preset", preset, "-global_quality", q]
    case "amf":
      // AMF uses a "quality" knob (speed/balanced/quality) alongside
      // constant-QP rate control; the user's `preset` populates the
      // former and `quality` the latter.
      return [
        "-c:v",
        codecName,
        "-quality",
        preset,
        "-rc",
        "cqp",
        "-qp_i",
        q,
        "-qp_p",
        q,
      ]
    case "vaapi":
      // VAAPI ignores the preset string — the API just doesn't expose
      // one. We feed `qp` directly. (admins still set a preset value
      // because the schema requires one; we just don't emit it.)
      return ["-c:v", codecName, "-qp", q]
  }
}

/**
 * Resolve the ffmpeg encoder name for a (hwaccel, codec) pair. Centralised
 * so capability detection in admin.ts can reuse the same table when
 * reporting which backends are available on the host.
 */
export function codecNameFor(
  hwaccel: HwaccelKind,
  codec: "h264" | "hevc"
): string {
  if (hwaccel === "software") {
    return codec === "h264" ? "libx264" : "libx265"
  }
  return `${codec}_${hwaccel}`
}

/**
 * Extract a single frame at `atSeconds` and scale it to `width` pixels
 * wide (height auto-computed to preserve aspect). The container is
 * derived from `outPath`'s extension; .jpg is fine for posters.
 */
export async function thumbnail(
  srcPath: string,
  outPath: string,
  opts: { width: number; atSeconds: number }
): Promise<void> {
  const args = [
    "-hide_banner",
    "-y",
    // -ss before -i is fast (input seek) but slightly less accurate.
    // For poster frames around 1s in we don't care.
    "-ss",
    String(opts.atSeconds),
    "-i",
    srcPath,
    "-frames:v",
    "1",
    "-vf",
    `scale=${opts.width}:-2`,
    outPath,
  ]
  await runCapture(env.FFMPEG_BIN, args)
}

/**
 * Format a millisecond count as ffmpeg's `HH:MM:SS.mmm` timestamp. Three
 * decimal places of seconds are enough for clip-level trim — anything
 * finer than a frame would just be jitter against keyframe boundaries.
 */
function msToFfmpegTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1000)
  const millis = totalMs % 1000
  return (
    `${hours.toString().padStart(2, "0")}:` +
    `${minutes.toString().padStart(2, "0")}:` +
    `${seconds.toString().padStart(2, "0")}.` +
    `${millis.toString().padStart(3, "0")}`
  )
}

// ─── Process helpers ───────────────────────────────────────────────────

interface CaptureResult {
  stdout: string
  stderr: string
}

function runCapture(
  bin: string,
  args: ReadonlyArray<string>
): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    proc.on("error", reject)
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(
          new Error(
            `${bin} exited ${code}: ${stderr.trim().slice(-500) || "(no stderr)"}`
          )
        )
      }
    })
  })
}

/**
 * Run `bin` and feed each stderr line into `onLine`. Resolves on clean
 * exit; rejects with the tail of stderr on non-zero exit (so the caller
 * can surface a useful failure reason).
 *
 * When `signal` is provided, aborting it SIGTERMs the child and the
 * returned promise rejects with a tagged `AbortError` — callers
 * distinguish that from a genuine ffmpeg failure so a user-initiated
 * cancel doesn't churn pg-boss retries or get recorded as a failure
 * reason on a row that's being deleted.
 */
function runWithProgress(
  bin: string,
  args: ReadonlyArray<string>,
  onLine: (line: string) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderrTail = ""
    let buf = ""
    let aborted = false
    proc.stderr.on("data", (chunk) => {
      const text = String(chunk)
      stderrTail = (stderrTail + text).slice(-2000)
      buf += text
      let idx: number
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (line) onLine(line)
      }
    })
    // Deliver SIGTERM on abort; the `close` handler resolves the
    // promise as AbortError because `aborted` is set.
    const onAbort = () => {
      aborted = true
      // `kill` returns false if the child already exited — harmless.
      proc.kill("SIGTERM")
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    proc.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort)
      reject(err)
    })
    proc.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort)
      if (aborted) {
        reject(abortError())
        return
      }
      if (code === 0) {
        if (buf) onLine(buf)
        resolve()
      } else {
        reject(
          new Error(`${bin} exited ${code}: ${stderrTail.trim().slice(-500)}`)
        )
      }
    })
  })
}

function abortError(): Error {
  // DOMException is available in Node ≥17 and gives a properly-tagged
  // `.name === "AbortError"` that downstream `instanceof`-free checks
  // can key off without importing anything.
  return new DOMException("Encode cancelled", "AbortError")
}
