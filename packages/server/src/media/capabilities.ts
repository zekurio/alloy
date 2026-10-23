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
import { errorMessage } from "@alloy/server/runtime/error-message"

import {
  buildEncoderGlobalArgs,
  buildEncoderVideoArgs,
  buildVideoFilterChain,
  transcodeEncoder,
  transcodeEncoderName,
} from "./encoders"
import { FFMPEG_BATCH_ARGS } from "./ffmpeg"
import { processFailureKind, runProcess } from "./run-process"
import { transcodeSettings } from "./transcode-settings"

const PROBE_TIMEOUT_MS = 15_000

let cached: {
  vaapiDevice: string
  capabilities: TranscodingCapabilities
} | null = null
let inflight: {
  vaapiDevice: string
  promise: Promise<TranscodingCapabilities>
} | null = null

/**
 * Probe what the configured ffmpeg can encode. The result is cached per VAAPI
 * device, and concurrent callers for one device share a single in-flight
 * probe, so repeated refreshes don't run the encoder matrix again.
 */
export function probeTranscodingCapabilities(options?: {
  refresh?: boolean
  /** VAAPI render node to test against; defaults to the schema default. */
  vaapiDevice?: string
}): Promise<TranscodingCapabilities> {
  const vaapiDevice = options?.vaapiDevice ?? DEFAULT_VAAPI_DEVICE
  if (cached && !options?.refresh && cached.vaapiDevice === vaapiDevice) {
    return Promise.resolve(cached.capabilities)
  }
  if (inflight?.vaapiDevice === vaapiDevice) return inflight.promise

  const promise = probeCapabilities(vaapiDevice)
    .then((capabilities) => {
      cached = { vaapiDevice, capabilities }
      return capabilities
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null
    })
  inflight = { vaapiDevice, promise }
  return promise
}

async function probeCapabilities(
  vaapiDevice: string,
): Promise<TranscodingCapabilities> {
  const ffmpegPath = transcodeSettings().ffmpegPath
  const versionResult = await runProbe(ffmpegPath, ["-version"])
  if (versionResult.spawnFailed) {
    return {
      ffmpegPath,
      version: null,
      jellyfin: false,
      probedAt: new Date().toISOString(),
      encoders: missingEncoderProbes(),
    }
  }

  const encodersResult = await runProbe(ffmpegPath, [
    "-hide_banner",
    "-encoders",
  ])
  const presentEncoders = encodersResult.ok
    ? parseFfmpegEncoders(encodersResult.stdout)
    : new Set<string>()

  return {
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
}

function parseFfmpegEncoders(output: string): Set<string> {
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
      )
      probes.push({
        codec,
        acceleration,
        encoder: encoder.name,
        status: result.ok ? "ok" : "failed",
        error: result.ok ? undefined : stderrTail(result.stderr),
      })
    }
  }
  return probes
}

function functionalProbeArgs(config: TranscodingConfig): string[] {
  return [
    ...FFMPEG_BATCH_ARGS,
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

interface ProbeResult {
  ok: boolean
  stdout: string
  stderr: string
  spawnFailed: boolean
}

/** Run one probe; failures are part of the result, never thrown. */
async function runProbe(command: string, args: string[]): Promise<ProbeResult> {
  const stdoutLines: string[] = []
  const stderrLines: string[] = []
  try {
    await runProcess({
      name: "ffmpeg",
      command,
      args,
      timeoutMs: PROBE_TIMEOUT_MS,
      onStdoutLine: (line) => stdoutLines.push(line),
      onStderrLine: (line) => stderrLines.push(line),
    })
  } catch (cause) {
    const kind = processFailureKind(cause)
    const stdout = stdoutLines.join("\n")
    const stderr = stderrLines.join("\n")
    if (kind === "exit")
      return { ok: false, stdout, stderr, spawnFailed: false }
    if (kind === "timeout") {
      return {
        ok: false,
        stdout,
        stderr: `${stderr}\nprobe timed out`,
        spawnFailed: false,
      }
    }
    return {
      ok: false,
      stdout,
      stderr: errorMessage(cause, "probe failed"),
      spawnFailed: true,
    }
  }
  return {
    ok: true,
    stdout: stdoutLines.join("\n"),
    stderr: stderrLines.join("\n"),
    spawnFailed: false,
  }
}
