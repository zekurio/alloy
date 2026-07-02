import type { MediaProbe } from "@alloy/server/media/probe"
import { clipStorage } from "@alloy/server/storage/index"

export type Asset = {
  storageKey: string
  contentType: string
  sizeBytes: number
}

export type SourceAsset = Asset & {
  width: number
  height: number
  videoCodec: string | null
  audioCodec: string | null
}

export async function publishOriginalSource({
  sourcePath,
  sourceKey,
  contentType,
  probe,
}: {
  sourcePath: string
  sourceKey: string
  contentType: string
  probe: MediaProbe
}): Promise<SourceAsset> {
  const { size } = await clipStorage.uploadFromFile(
    sourcePath,
    sourceKey,
    contentType,
  )
  return {
    storageKey: sourceKey,
    contentType,
    sizeBytes: size,
    width: probe.width,
    height: probe.height,
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
  }
}
