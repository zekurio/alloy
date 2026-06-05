import { clipStorage } from "../storage"
import { probe } from "./ffmpeg"

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
}: {
  sourcePath: string
  sourceKey: string
  contentType: string
}): Promise<SourceAsset> {
  const rawProbe = await probe(sourcePath)
  const { size } = await clipStorage.uploadFromFile(
    sourcePath,
    sourceKey,
    contentType,
  )
  return {
    storageKey: sourceKey,
    contentType,
    sizeBytes: size,
    width: rawProbe.width,
    height: rawProbe.height,
    videoCodec: rawProbe.videoCodec,
    audioCodec: rawProbe.audioCodec,
  }
}
