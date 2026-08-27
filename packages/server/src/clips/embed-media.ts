import { sourceIsBroadlyDecodable } from "@alloy/server/clips/codecs"

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
  cutCodecs: string | null
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
 * multi-hundred-megabyte originals a capture card produces. The rendition
 * embeds with whatever codec the ladder encoded — H.264 compatibility is the
 * admin's ladder choice, not a constraint enforced here. The source is used
 * only when it is already a verified broadly-decodable asset.
 */
export function embedVideo(
  row: EmbedMediaClip,
  origin: string,
): EmbedVideo | null {
  const renditionRows = row.renditionRows ?? []
  // Rows arrive tallest-first; without an og flag the tallest tier is the
  // link preview, matching effectiveOgTierIndex in the ladder settings.
  const rendition =
    renditionRows.find((candidate) => candidate.og) ?? renditionRows[0] ?? null

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
  const playbackCodecs = row.cutKey ? row.cutCodecs : row.sourceCodecs

  if (
    playbackSourceKey &&
    sourceIsBroadlyDecodable(playbackCodecs) &&
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

  return null
}
