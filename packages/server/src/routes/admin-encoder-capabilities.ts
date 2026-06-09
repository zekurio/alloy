import { spawn } from "node:child_process"

import {
  type AdminEncoderCapabilities as EncoderCapabilities,
  ENCODER_CODECS,
  ENCODER_HWACCELS,
  type EncoderCodec,
  type EncoderHwaccel,
} from "alloy-contracts"
import { logger } from "alloy-logging"

import { configStore } from "../config/store"
import { env } from "../env"
import { codecNameFor } from "../queue/ffmpeg-args"
import {
  emptyEncoderAvailability,
  encoderAvailabilityFromProbe,
} from "./admin-encoder-capability-map"

const CAPABILITY_TTL_MS = 5 * 60_000

let capabilityCache: {
  expiresAt: number
  value: EncoderCapabilities
} | null = null
let capabilityRefresh: Promise<EncoderCapabilities> | null = null

function refreshEncoderCapabilities(): Promise<EncoderCapabilities> {
  if (!capabilityRefresh) {
    capabilityRefresh = probeEncoderCapabilities()
      .then((value) => {
        capabilityCache = { value, expiresAt: Date.now() + CAPABILITY_TTL_MS }
        return value
      })
      .finally(() => {
        capabilityRefresh = null
      })
  }
  return capabilityRefresh
}

/**
 * Cached encoder capabilities. The probe smoke-tests every encoder (seconds of
 * ffmpeg spawns), so once warm we serve the cached value immediately and
 * refresh in the background when stale — a request never blocks on it except
 * the very first cold call. Warmed at startup via {@link warmEncoderCapabilities}.
 */
export async function getEncoderCapabilities(): Promise<EncoderCapabilities> {
  if (capabilityCache) {
    if (capabilityCache.expiresAt <= Date.now()) {
      refreshEncoderCapabilities().catch(() => undefined)
    }
    return capabilityCache.value
  }
  return refreshEncoderCapabilities()
}

/** Kick off the first capability probe in the background so the first stream
 *  request doesn't pay for it. Safe to call once at startup. */
export function warmEncoderCapabilities(): void {
  if (!capabilityCache) refreshEncoderCapabilities().catch(() => undefined)
}

export function clearEncoderCapabilitiesCache(): void {
  capabilityCache = null
}

async function probeEncoderCapabilities(): Promise<EncoderCapabilities> {
  const empty = emptyEncoderAvailability()

  const stdout = await optionalCapture("encoder list", [
    "-hide_banner",
    "-encoders",
  ])
  if (!stdout) return { ffmpegOk: false, ffmpegVersion: null, available: empty }

  const names = new Set<string>()
  for (const line of stdout.split("\n")) {
    const m = /^\s[A-Z.]{6}\s+(\S+)/.exec(line)
    if (m && m[1]) names.add(m[1])
  }

  const hwaccels = parseHwaccels(
    await optionalCapture("hardware accelerator list", [
      "-hide_banner",
      "-hwaccels",
    ]),
  )
  const filters = parseFilters(
    await optionalCapture("filter list", ["-hide_banner", "-filters"]),
  )

  const available = encoderAvailabilityFromProbe({
    encoders: names,
    filters,
    hwaccels,
  })
  await smokeTestEncoders(available)

  const versionStdout = await optionalCapture("version", [
    "-hide_banner",
    "-version",
  ])
  const ffmpegVersion = versionStdout
    ? (versionStdout.split("\n")[0] ?? "").trim() || null
    : null

  return { ffmpegOk: true, ffmpegVersion, available }
}

async function smokeTestEncoders(
  available: EncoderCapabilities["available"],
): Promise<void> {
  const encoderConfig = configStore.get("encoder")
  const tests: (() => Promise<EncoderSmokeTestFailure | null>)[] = []

  for (const hwaccel of ENCODER_HWACCELS) {
    for (const codec of ENCODER_CODECS) {
      if (!available[hwaccel][codec]) continue
      tests.push(() => smokeTestEncoder(hwaccel, codec, encoderConfig))
    }
  }

  const results = await runLimited(tests, 2)
  for (const result of results) {
    if (!result) continue
    available[result.hwaccel][result.codec] = false
    logger.warn(
      `[admin/encoder] ${result.encoder} smoke test failed; marking unavailable: ${result.reason}`,
    )
  }
}

async function runLimited<T>(
  tasks: readonly (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = []
  let nextIndex = 0

  async function worker() {
    while (nextIndex < tasks.length) {
      const task = tasks[nextIndex]
      nextIndex += 1
      if (task) results.push(await task())
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrency, tasks.length)) },
      () => worker(),
    ),
  )
  return results
}

async function smokeTestEncoder(
  hwaccel: EncoderHwaccel,
  codec: EncoderCodec,
  encoderConfig: { qsvDevice: string; vaapiDevice: string },
): Promise<EncoderSmokeTestFailure | null> {
  const encoder = codecNameFor(hwaccel, codec)
  const args = encoderSmokeTestArgs(hwaccel, encoder, encoderConfig)
  const output = await runSmokeTest(env.FFMPEG_BIN, args)
  if (output.ok) return null
  return {
    hwaccel,
    codec,
    encoder,
    reason: output.reason,
  }
}

type EncoderSmokeTestFailure = {
  hwaccel: EncoderHwaccel
  codec: EncoderCodec
  encoder: string
  reason: string
}

function encoderSmokeTestArgs(
  hwaccel: EncoderHwaccel,
  encoder: string,
  encoderConfig: { qsvDevice: string; vaapiDevice: string },
): string[] {
  const args = ["-hide_banner", "-loglevel", "error"]
  if (hwaccel === "qsv") {
    args.push("-qsv_device", encoderConfig.qsvDevice)
  } else if (hwaccel === "vaapi") {
    args.push("-vaapi_device", encoderConfig.vaapiDevice)
  }
  // Encode ~0.5s rather than a single frame: HEVC/AV1 encoders (notably the
  // VAAPI/QSV ones) buffer a small lookahead and emit nothing for a 1-frame
  // input, which false-negatives a working encoder. A handful of frames forces
  // at least one output packet while staying fast.
  args.push("-f", "lavfi", "-i", "testsrc2=s=256x256:d=0.5", "-an")
  if (hwaccel === "vaapi") {
    args.push("-vf", "format=nv12,hwupload_vaapi")
  }
  args.push("-c:v", encoder, "-b:v", "1000000", "-f", "null", "-")
  return args
}

async function runSmokeTest(
  bin: string,
  args: ReadonlyArray<string>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const output = await runProcess(bin, args, {
      signal: controller.signal,
      stdout: false,
      stderr: true,
    })
    if (output.code === 0) return { ok: true }
    const stderr = output.stderr.trim()
    return {
      ok: false,
      reason: summarizeFfmpegFailure(stderr) || `${bin} exited ${output.code}`,
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function summarizeFfmpegFailure(stderr: string): string | null {
  for (const line of stderr.split("\n").toReversed()) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed === "Conversion failed!") continue
    if (trimmed.includes("Terminating thread with return code")) continue
    if (trimmed.includes("Nothing was written into output file")) continue
    return trimmed
  }
  return null
}

function parseHwaccels(stdout: string | null): Set<string> {
  const hwaccels = new Set<string>()
  if (!stdout) return hwaccels

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.endsWith(":")) continue
    hwaccels.add(trimmed)
  }
  return hwaccels
}

function parseFilters(stdout: string | null): Set<string> {
  const filters = new Set<string>()
  if (!stdout) return filters

  for (const line of stdout.split("\n")) {
    const m = /^\s[ TSC.]{3}\s+(\S+)/.exec(line)
    if (m && m[1]) filters.add(m[1])
  }
  return filters
}

async function optionalCapture(
  label: string,
  args: ReadonlyArray<string>,
): Promise<string | null> {
  try {
    return await runCapture(env.FFMPEG_BIN, args)
  } catch (err) {
    logger.warn(`[admin/encoder] ffmpeg ${label} probe failed:`, err)
    return null
  }
}

async function runCapture(
  bin: string,
  args: ReadonlyArray<string>,
): Promise<string> {
  const output = await runProcess(bin, args, { stdout: true, stderr: false })
  if (output.code !== 0) {
    throw new Error(`${bin} exited ${output.code}`)
  }
  return output.stdout
}

async function runProcess(
  bin: string,
  args: ReadonlyArray<string>,
  opts: {
    signal?: AbortSignal
    stdout: boolean
    stderr: boolean
  },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(bin, [...args], {
    signal: opts.signal,
    stdio: [
      "ignore",
      opts.stdout ? "pipe" : "ignore",
      opts.stderr ? "pipe" : "ignore",
    ],
  })
  const exit = new Promise<number>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code) => resolve(code ?? 1))
  })
  const decoder = new TextDecoder()
  let stdout = ""
  let stderr = ""
  const [code] = await Promise.all([
    exit,
    (async () => {
      if (!child.stdout) return
      for await (const chunk of child.stdout) {
        stdout += decoder.decode(chunk, { stream: true })
      }
    })(),
    (async () => {
      if (!child.stderr) return
      for await (const chunk of child.stderr) {
        stderr += decoder.decode(chunk, { stream: true })
      }
    })(),
  ])
  return {
    code,
    stdout,
    stderr,
  }
}
