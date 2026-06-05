import {
  type AdminEncoderCapabilities as EncoderCapabilities,
  ENCODER_CODECS,
  ENCODER_HWACCELS,
  type EncoderCodec,
  type EncoderHwaccel,
} from "@workspace/contracts"
import { logger } from "@workspace/logging"

import { configStore } from "../config/store"
import { env } from "../env"
import { codecNameFor } from "../queue/ffmpeg-args"
import {
  emptyEncoderAvailability,
  encoderAvailabilityFromProbe,
} from "./admin-encoder-capability-map"

let capabilityCache: {
  expiresAt: number
  value: EncoderCapabilities
} | null = null

export async function getEncoderCapabilities(): Promise<EncoderCapabilities> {
  if (capabilityCache && capabilityCache.expiresAt > Date.now()) {
    return capabilityCache.value
  }
  const value = await probeEncoderCapabilities()
  capabilityCache = { value, expiresAt: Date.now() + 5 * 60_000 }
  return value
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
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
  ]
  if (hwaccel === "qsv") {
    args.push("-qsv_device", encoderConfig.qsvDevice)
  } else if (hwaccel === "vaapi") {
    args.push("-vaapi_device", encoderConfig.vaapiDevice)
  }
  args.push(
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=128x128:d=0.1",
    "-frames:v",
    "1",
    "-an",
  )
  if (hwaccel === "vaapi") {
    args.push("-vf", "format=nv12,hwupload_vaapi")
  }
  args.push(
    "-c:v",
    encoder,
    "-b:v",
    "1000000",
    "-f",
    "null",
    "-",
  )
  return args
}

async function runSmokeTest(
  bin: string,
  args: ReadonlyArray<string>,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const output = await new Deno.Command(bin, {
      args: [...args],
      stdin: "null",
      stdout: "null",
      stderr: "piped",
      signal: controller.signal,
    }).output()
    if (output.success) return { ok: true }
    const stderr = new TextDecoder().decode(output.stderr).trim()
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
  const output = await new Deno.Command(bin, {
    args: [...args],
    stdin: "null",
    stdout: "piped",
    stderr: "null",
  }).output()
  if (!output.success) {
    throw new Error(`${bin} exited ${output.code}`)
  }
  return new TextDecoder().decode(output.stdout)
}
