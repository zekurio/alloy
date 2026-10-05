import { clipShareUrl } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"

import { selectEmbeddableClip } from "./clips/access"
import { clipIdFromPath } from "./clips/permalink"
import { env } from "./env"
import { htmlEscape } from "./web-html"

const logger = createLogger("web")

type MetadataClip = NonNullable<
  Awaited<ReturnType<typeof selectEmbeddableClip>>
>

export async function clipHead(
  pathname: string,
  timestamp?: number,
): Promise<string> {
  const clipId = clipIdFromPath(pathname)
  if (!clipId) return ""

  try {
    const row = await selectEmbeddableClip(clipId)
    return row ? buildClipHead(row, timestamp) : ""
  } catch (error) {
    logger.error("failed to build clip metadata:", error)
    return ""
  }
}

function buildClipHead(row: MetadataClip, timestamp?: number): string {
  const origin = env.PUBLIC_SERVER_URL
  const permalink = clipShareUrl(row.id, origin, timestamp)
  const oembedUrl = new URL("/api/oembed", origin)
  oembedUrl.searchParams.set("url", permalink)

  return [
    `<title>${htmlEscape(row.title)} | alloy</title>`,
    // oEmbed supplies the clickable site name; OpenGraph supplies the clip link.
    `<link rel="alternate" type="application/json+oembed" href="${htmlEscape(oembedUrl.toString())}" />`,
    metaProperty("og:site_name", "alloy"),
    metaProperty("og:type", "website"),
    metaProperty("og:url", permalink),
    metaProperty("og:title", row.title),
  ].join("\n    ")
}

function metaProperty(property: string, content: string): string {
  return `<meta property="${property}" content="${htmlEscape(content)}" />`
}
