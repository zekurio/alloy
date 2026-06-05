import type { EncoderCodec } from "@workspace/contracts"

type LiveCodecProbe = {
  codec: EncoderCodec
  mimeTypes: readonly string[]
}

const LIVE_CODEC_PROBES: readonly LiveCodecProbe[] = [
  {
    codec: "av1",
    mimeTypes: ['video/mp4; codecs="av01.0.08M.08,mp4a.40.2"'],
  },
  {
    codec: "hevc",
    mimeTypes: [
      'video/mp4; codecs="hvc1.1.6.L120.B0,mp4a.40.2"',
      'video/mp4; codecs="hev1.1.6.L120.B0,mp4a.40.2"',
    ],
  },
  {
    codec: "h264",
    mimeTypes: ['video/mp4; codecs="avc1.42E01E,mp4a.40.2"'],
  },
]

export function liveCodecsFromSupport({
  canPlayType,
  mediaSourceCanPlay,
}: {
  canPlayType: (mimeType: string) => string
  mediaSourceCanPlay?: (mimeType: string) => boolean
}): EncoderCodec[] {
  return LIVE_CODEC_PROBES.filter(({ mimeTypes }) =>
    mimeTypes.some(
      (mimeType) =>
        canPlayType(mimeType) !== "" || Boolean(mediaSourceCanPlay?.(mimeType)),
    ),
  ).map(({ codec }) => codec)
}

export function browserLiveCodecs(): EncoderCodec[] {
  if (typeof document === "undefined") return []
  const video = document.createElement("video")
  return liveCodecsFromSupport({
    canPlayType: (mimeType) => video.canPlayType(mimeType),
    mediaSourceCanPlay: browserMediaSourceCanPlay,
  })
}

function browserMediaSourceCanPlay(mimeType: string): boolean {
  if (typeof globalThis === "undefined") return false
  const mediaGlobals = globalThis as typeof globalThis & {
    MediaSource?: typeof MediaSource
    ManagedMediaSource?: typeof MediaSource
  }
  const MS = mediaGlobals.MediaSource ?? mediaGlobals.ManagedMediaSource
  return Boolean(
    MS &&
    typeof MS.isTypeSupported === "function" &&
    MS.isTypeSupported(mimeType),
  )
}
