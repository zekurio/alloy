import { configStore } from "../config/store"
import { codecNameFor, encode, type SourceColorInfo } from "../queue/ffmpeg"
import { clipAssetKey, clipStorage } from "../storage"

export const OPEN_GRAPH_CONTENT_TYPE = "video/mp4"

export type OpenGraphVariantAsset = {
  storageKey: string
  contentType: typeof OPEN_GRAPH_CONTENT_TYPE
  sizeBytes: number
}

export type OpenGraphSourceProbe = {
  durationMs: number
  height: number
  color: SourceColorInfo
}

export async function publishOpenGraphVariant({
  clipId,
  sourcePath,
  outPath,
  source,
  signal,
  onProgress,
}: {
  clipId: string
  sourcePath: string
  outPath: string
  source: OpenGraphSourceProbe
  signal?: AbortSignal
  onProgress: (pct: number) => void
}): Promise<OpenGraphVariantAsset> {
  const config = configStore.get("encoder")
  await encode(sourcePath, outPath, {
    config: {
      hwaccel: config.hwaccel,
      encoder: codecNameFor(config.hwaccel, "h264"),
      quality: 23,
      audioBitrateKbps: 256,
      extraInputArgs: "",
      extraOutputArgs: "",
      qsvDevice: config.qsvDevice,
      vaapiDevice: config.vaapiDevice,
      intelLowPowerH264: config.intelLowPowerH264,
      intelLowPowerHevc: config.intelLowPowerHevc,
      tonemapping: config.tonemapping,
      sourceColor: source.color,
    },
    targetHeight: Math.min(source.height, 1080),
    durationMs: source.durationMs,
    onProgress,
    signal,
  })

  const storageKey = clipAssetKey(clipId, "opengraph")
  const { size } = await clipStorage.uploadFromFile(
    outPath,
    storageKey,
    OPEN_GRAPH_CONTENT_TYPE,
  )

  return {
    storageKey,
    contentType: OPEN_GRAPH_CONTENT_TYPE,
    sizeBytes: size,
  }
}

export async function statOpenGraphVariant(
  key: string | null,
): Promise<{ exists: boolean; sizeBytes: number | null }> {
  if (!key) return { exists: false, sizeBytes: null }
  const resolved = await clipStorage.resolve(key)
  if (!resolved) return { exists: false, sizeBytes: null }
  return { exists: true, sizeBytes: resolved.size }
}
