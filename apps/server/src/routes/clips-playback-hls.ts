import type { ClipPlaybackQuality, ClipPrivacy } from "alloy-contracts"

import { parseRequestedLiveCodecs, selectLiveCodec } from "../clips/live-codec"
import {
  liveHlsCachedCodecs,
  makeLiveHlsSpec,
  type LiveHlsSpec,
} from "../clips/live-hls-cache"
import { buildPlaybackQualities } from "../clips/playback-quality"
import { configStore } from "../config/store"
import { mediaCacheControl } from "./clips-playback-streams"

export type LiveTranscodeClipRow = {
  id: string
  sourceKey: string | null
}

export type LiveHlsClipRow = LiveTranscodeClipRow & {
  sourceSizeBytes: number | null
  durationMs: number | null
  width: number | null
  height: number | null
  updatedAt: Date | string
}

export async function liveHlsSpecsForRow(
  row: LiveHlsClipRow,
  codecQuery: string | undefined,
  variantId: string | undefined,
): Promise<LiveHlsSpec[]> {
  if (!row.sourceKey || !row.durationMs) return []
  const encoderConfig = configStore.get("encoder")
  if (!encoderConfig.enabled) return []
  const requestedCodecs = parseRequestedLiveCodecs(codecQuery)
  const selectedCodec = await selectLiveCodec(
    encoderConfig.hwaccel,
    requestedCodecs.codecs,
  )
  if (!selectedCodec) return []

  return buildPlaybackQualities(row)
    .filter((quality) => !variantId || quality.id === variantId)
    .map((quality: ClipPlaybackQuality) =>
      makeLiveHlsSpec({
        clipId: row.id,
        sourceKey: row.sourceKey as string,
        sourceSizeBytes: row.sourceSizeBytes,
        updatedAt: row.updatedAt,
        quality,
        codec: selectedCodec.codec,
        encoder: selectedCodec.encoder,
        encoderConfig,
      }),
    )
}

export function findLiveHlsSpec(
  specs: readonly LiveHlsSpec[],
  cacheKey: string,
): LiveHlsSpec | null {
  return specs.find((spec) => spec.cacheKey === cacheKey) ?? null
}

type LiveHlsMasterStream = { spec: LiveHlsSpec; codecs: string }

export function buildLiveHlsMasterPlaylist(
  streams: readonly LiveHlsMasterStream[],
  codecQuery: string | undefined,
): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"]
  const querySuffix = liveHlsQuerySuffix(codecQuery)
  for (const { spec, codecs } of streams) {
    const quality = spec.quality
    const attrs = [
      `BANDWIDTH=${quality.bitrate}`,
      `AVERAGE-BANDWIDTH=${quality.bitrate}`,
      quality.width ? `RESOLUTION=${quality.width}x${quality.height}` : null,
      `CODECS="${codecs}"`,
    ].filter((attr): attr is string => attr !== null)
    lines.push(`#EXT-X-STREAM-INF:${attrs.join(",")}`)
    lines.push(`${spec.cacheKey}/stream.m3u8${querySuffix}`)
  }
  return `${lines.join("\n")}\n`
}

export function liveHlsMasterStreams(
  specs: readonly LiveHlsSpec[],
  hasAudio: boolean,
): LiveHlsMasterStream[] {
  return specs.map((spec) => ({
    spec,
    codecs:
      liveHlsCachedCodecs(spec.cacheKey) ??
      hlsCodecString(spec.codec, hasAudio),
  }))
}

export function hlsCacheControl(privacy: ClipPrivacy): string {
  return privacy === "public"
    ? "public, max-age=300"
    : mediaCacheControl(privacy)
}

export function liveHlsQuerySuffix(codecQuery: string | undefined): string {
  return codecQuery ? `?codecs=${encodeURIComponent(codecQuery)}` : ""
}

export function ticksToSeconds(ticks: number | undefined): number {
  return ticks === undefined ? 0 : Math.max(0, ticks / 10_000_000)
}

function hlsCodecString(codec: string, hasAudio: boolean): string {
  const video =
    codec === "av1"
      ? "av01.0.08M.08"
      : codec === "hevc"
        ? "hvc1.1.6.L120.90"
        : "avc1.42E01E"
  return hasAudio ? `${video},mp4a.40.2` : video
}
