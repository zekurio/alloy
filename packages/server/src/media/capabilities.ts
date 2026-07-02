import { spawn } from "node:child_process"

import type {
  HardwareAcceleration,
  TranscodingCapabilities,
  TranscodingConfig,
  TranscodingEncoderProbe,
  VideoCodec,
} from "@alloy/contracts"
import {
  DEFAULT_VAAPI_DEVICE,
  HARDWARE_ACCELERATIONS,
  TRANSCODE_VIDEO_CODECS,
  TranscodingConfigSchema,
} from "@alloy/contracts"

import {
  buildEncoderGlobalArgs,
  buildEncoderVideoArgs,
  buildVideoFilterChain,
  transcodeEncoder,
  transcodeEncoderName,
} from "./encoders"
import { transcodeSettings } from "./transcode-settings"

const PROBE_TIMEOUT_MS = 15_000

let cachedCapabilities: TranscodingCapabilities | null = null
let cachedVaapiDevice: string | null = null

export async function probeTranscodingCapabilities(options?: {
  refresh?: boolean
  /** VAAPI render node to test against; defaults to the schema default. */
  vaapiDevice?: string
}): Promise<TranscodingCapabilities> {
  const vaapiDevice = options?.vaapiDevice ?? DEFAULT_VAAPI_DEVICE
  if (
    cachedCapabilities &&
    !options?.refresh &&
    cachedVaapiDevice === vaapiDevice
  ) {
    return cachedCapabilities
  }
  cachedVaapiDevice = vaapiDevice

  const ffmpegPath = transcodeSettings().ffmpegPath
  const versionResult = await runProbe(
    ffmpegPath,
    ["-version"],
    PROBE_TIMEOUT_MS,
  )
  if (versionResult.spawnFailed) {
    cachedCapabilities = {
      ffmpegPath,
      version: null,
      jellyfin: false,
      probedAt: new Date().toISOString(),
      encoders: missingEncoderProbes(),
    }
    return cachedCapabilities
  }

  const encodersResult = await runProbe(
    ffmpegPath,
    ["-hide_banner", "-encoders"],
    PROBE_TIMEOUT_MS,
  )
  const presentEncoders =
    encodersResult.status === 0
      ? parseFfmpegEncoders(encodersResult.stdout)
      : new Set<string>()

  cachedCapabilities = {
    ffmpegPath,
    version: firstNonEmptyLine(versionResult.stdout),
    jellyfin: /jellyfin/i.test(versionResult.stdout),
    probedAt: new Date().toISOString(),
    encoders: await probeEncoderMatrix(
      ffmpegPath,
      presentEncoders,
      vaapiDevice,
    ),
  }
  return cachedCapabilities
}

export function parseFfmpegEncoders(output: string): Set<string> {
  const encoders = new Set<string>()
  for (const line of output.split("\n")) {
    const match = /^\s*[VASDT.]{6}\s+([^\s]+)\s/.exec(line)
    if (match?.[1]) encoders.add(match[1])
  }
  return encoders
}

async function probeEncoderMatrix(
  ffmpegPath: string,
  presentEncoders: Set<string>,
  vaapiDevice: string,
): Promise<TranscodingEncoderProbe[]> {
  const probes: TranscodingEncoderProbe[] = []
  for (const codec of TRANSCODE_VIDEO_CODECS) {
    for (const acceleration of HARDWARE_ACCELERATIONS) {
      const encoder = transcodeEncoder(codec, acceleration)
      if (!encoder || !presentEncoders.has(encoder.name)) {
        probes.push({
          codec,
          acceleration,
          encoder: transcodeEncoderName(codec, acceleration),
          status: "missing",
        })
        continue
      }
      const result = await runProbe(
        ffmpegPath,
        functionalProbeArgs(testConfig(codec, acceleration, vaapiDevice)),
        PROBE_TIMEOUT_MS,
      )
      probes.push({
        codec,
        acceleration,
        encoder: encoder.name,
        status: result.status === 0 ? "ok" : "failed",
        ...(result.status === 0 ? {} : { error: stderrTail(result.stderr) }),
      })
    }
  }
  return probes
}

function functionalProbeArgs(config: TranscodingConfig): string[] {
  return [
    "-hide_banner",
    "-nostdin",
    ...buildEncoderGlobalArgs(config),
    "-f",
    "lavfi",
    "-i",
    "color=black:s=256x256:r=30:d=0.1",
    "-vf",
    buildVideoFilterChain(config, ["scale=-2:256:flags=lanczos"]),
    ...buildEncoderVideoArgs({
      config,
      maxrateKbps: config.hardwareAcceleration === "vaapi" ? 1000 : undefined,
    }),
    "-frames:v",
    "1",
    "-f",
    "null",
    "-",
  ]
}

function testConfig(
  videoCodec: VideoCodec,
  hardwareAcceleration: HardwareAcceleration,
  vaapiDevice: string,
): TranscodingConfig {
  return TranscodingConfigSchema.parse({
    videoCodec,
    hardwareAcceleration,
    vaapiDevice,
  })
}

function missingEncoderProbes(): TranscodingEncoderProbe[] {
  return TRANSCODE_VIDEO_CODECS.flatMap((codec) =>
    HARDWARE_ACCELERATIONS.map((acceleration) => ({
      codec,
      acceleration,
      encoder: transcodeEncoderName(codec, acceleration),
      status: "missing" as const,
    })),
  )
}

function firstNonEmptyLine(value: string): string | null {
  return (
    value
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? null
  )
}

function stderrTail(value: string): string {
  const lines = value.split("\n").map((line) => line.trim())
  return lines.findLast(Boolean) ?? "encoder probe failed"
}

function runProbe(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{
  status: number | null
  stdout: string
  stderr: string
  spawnFailed: boolean
}> {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill("SIGTERM")
  }, timeoutMs)
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk
  })

  return new Promise<{
    status: number | null
    stdout: string
    stderr: string
    spawnFailed: boolean
  }>((resolve) => {
    child.once("error", (err) => {
      resolve({
        status: null,
        stdout,
        stderr: err.message,
        spawnFailed: true,
      })
    })
    child.once("close", (code) => {
      resolve({
        status: timedOut ? null : code,
        stdout,
        stderr: timedOut ? `${stderr}\nprobe timed out` : stderr,
        spawnFailed: false,
      })
    })
  }).finally(() => clearTimeout(timeout))
}
