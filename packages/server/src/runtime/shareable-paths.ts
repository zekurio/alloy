const CLIP_ID = String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`

// Social crawlers fetch clip media anonymously, so the poster and the embedded
// video file have to be reachable with requireAuthToBrowse on — otherwise the
// embed renders with a broken player on a default instance.
const SHAREABLE_CLIP_ASSET_RE = new RegExp(
  String.raw`^/api/clips/${CLIP_ID}/(?:stream|thumbnail|source/file|rendition/[a-z0-9-]+/file\.mp4)$`,
  "i",
)
const SHAREABLE_CLIP_DETAIL_RE = new RegExp(
  String.raw`^/api/clips/${CLIP_ID}$`,
  "i",
)
const SHAREABLE_CLIP_COMMENTS_RE = new RegExp(
  String.raw`^/api/clips/${CLIP_ID}/comments$`,
  "i",
)
const SHAREABLE_CLIP_VIEW_RE = new RegExp(
  String.raw`^/api/clips/${CLIP_ID}/view$`,
  "i",
)
// The oEmbed document, which supplies the embed's author line. The handler
// validates the url query itself and only ever resolves our own permalinks.
const SHAREABLE_OEMBED_RE = /^\/api\/oembed\/?$/

/**
 * Paths an anonymous visitor may reach even when the instance is set to
 * require auth to browse — the surfaces a shared clip link depends on.
 * Everything here is public-clip scoped; the handlers still enforce privacy.
 */
export function isShareableClipRequest(method: string, path: string): boolean {
  if (SHAREABLE_CLIP_ASSET_RE.test(path) || SHAREABLE_OEMBED_RE.test(path)) {
    return method === "GET" || method === "HEAD"
  }
  if (SHAREABLE_CLIP_DETAIL_RE.test(path)) return method === "GET"
  if (SHAREABLE_CLIP_COMMENTS_RE.test(path)) return method === "GET"
  if (SHAREABLE_CLIP_VIEW_RE.test(path)) return method === "POST"
  return false
}
