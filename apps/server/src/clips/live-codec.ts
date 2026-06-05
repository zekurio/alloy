import {
  type AdminEncoderCapabilities,
  ENCODER_CODECS,
  type EncoderCodec,
} from "@workspace/contracts"

import type { HwaccelKind } from "../config/store"
import { codecNameFor } from "../queue/ffmpeg-args"

const LIVE_CODEC_PRIORITY: readonly EncoderCodec[] = ["av1", "hevc", "h264"]
const CODEC_SET = new Set<EncoderCodec>(ENCODER_CODECS)

export function parseRequestedLiveCodecs(value: string | undefined): {
  codecs: EncoderCodec[]
  explicitlyRequested: boolean
} {
  if (!value) return { codecs: ["h264"], explicitlyRequested: false }

  const codecs: EncoderCodec[] = []
  for (const raw of value.split(",")) {
    const codec = raw.trim().toLowerCase()
    if (CODEC_SET.has(codec as EncoderCodec)) {
      codecs.push(codec as EncoderCodec)
    }
  }
  return { codecs, explicitlyRequested: true }
}

export async function selectLiveCodec(
  hwaccel: HwaccelKind,
  requestedCodecs: readonly EncoderCodec[],
): Promise<{ codec: EncoderCodec; encoder: string } | null> {
  const { getEncoderCapabilities } =
    await import("../routes/admin-encoder-capabilities.ts")
  const capabilities = await getEncoderCapabilities()
  return selectLiveCodecFromCapabilities(hwaccel, requestedCodecs, capabilities)
}

export function selectLiveCodecFromCapabilities(
  hwaccel: HwaccelKind,
  requestedCodecs: readonly EncoderCodec[],
  capabilities: AdminEncoderCapabilities,
): { codec: EncoderCodec; encoder: string } | null {
  if (!capabilities.ffmpegOk) return null

  const requested = new Set(requestedCodecs)
  const available = capabilities.available[hwaccel]
  for (const codec of LIVE_CODEC_PRIORITY) {
    if (requested.has(codec) && available[codec]) {
      return { codec, encoder: codecNameFor(hwaccel, codec) }
    }
  }
  return null
}
