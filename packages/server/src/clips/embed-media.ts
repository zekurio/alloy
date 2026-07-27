import {
  renditionIsH264,
  sourceIsBroadlyDecodable,
} from "@alloy/server/clips/codecs"

import { clipAssetVersion } from "./asset-version"

type EmbedRendition = {
  name: string
  og: boolean
  height: number
  width: number
  key: string
  codecs: string
}

export type EmbedMediaClip = {
  id: string
  width: number | null
  height: number | null
  thumbKey: string | null
  sourceKey: string | null
  sourceContentType: string | null
  sourceCodecs: string | null
  cutKey: string | null
  renditionRows?: EmbedRendition[]
}

export type EmbedVideo = {
  url: string
  type: string
  width: number | null
  height: number | null
}

export function embedPosterUrl(
  row: Pick<EmbedMediaClip, "id" | "thumbKey">,
  origin: string,
): string | null {
  if (!row.thumbKey) return null
  return new URL(
    `/api/clips/${row.id}/thumbnail?v=${clipAssetVersion(row.thumbKey)}`,
    origin,
  ).toString()
}

/**
 * Pick the file a social crawler should embed.
 *
 * Renditions win over the source: the `og`-flagged tier exists precisely to
 * power social embeds, and crawlers (Discord especially) give up on the
 * multi-hundred-megabyte originals a capture card produces. The source is only
 * a fallback for clips that have no usable rendition yet.
 *
 * Embeds are only reliable for H.264/AAC. Source codec metadata is required;
 * legacy null sourceCodecs must fall back to a rendition.
 */
export function embedVideo(
  row: EmbedMediaClip,
  origin: string,
): EmbedVideo | null {
  const renditionRows = row.renditionRows ?? []
  const rendition =
    renditionRows.find(
      (candidate) => candidate.og && renditionIsH264(candidate.codecs),
    ) ??
    renditionRows.find((candidate) => renditionIsH264(candidate.codecs)) ??
    null

  if (rendition) {
    return {
      url: new URL(
        `/api/clips/${row.id}/rendition/${rendition.name}/file.mp4?v=${clipAssetVersion(rendition.key)}`,
        origin,
      ).toString(),
      type: "video/mp4",
      width: rendition.width,
      height: rendition.height,
    }
  }

  const embeddableSource =
    row.sourceContentType === "video/mp4" ||
    row.sourceContentType === "video/webm"
  const playbackSourceKey = row.cutKey ?? row.sourceKey

  if (
    playbackSourceKey &&
    sourceIsBroadlyDecodable(row.sourceCodecs) &&
    (row.cutKey !== null || embeddableSource)
  ) {
    return {
      url: new URL(
        `/api/clips/${row.id}/source/file?v=${clipAssetVersion(playbackSourceKey)}`,
        origin,
      ).toString(),
      type: row.cutKey ? "video/mp4" : (row.sourceContentType ?? "video/mp4"),
      width: row.width,
      height: row.height,
    }
  }

  // Nothing committed yet: the range-capable stream endpoint is the only
  // option, and only when the raw upload is already a browser-safe container.
  if (renditionRows.length === 0 && row.sourceKey && embeddableSource) {
    return {
      url: new URL(`/api/clips/${row.id}/stream`, origin).toString(),
      type: row.sourceContentType ?? "video/mp4",
      width: row.width,
      height: row.height,
    }
  }

  return null
}
