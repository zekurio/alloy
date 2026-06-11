import { CustomSource } from "mediabunny"

/**
 * Reads a media source by byte range. Two transports share the shape:
 *
 * - The desktop's `alloy-capture://` protocol carries ranges as a
 *   `?range=start-end` query instead of a Range header: a custom header
 *   would force a CORS preflight on the cross-origin fetch to the custom
 *   scheme, while plain GETs work with the protocol's
 *   `Access-Control-Allow-Origin: *` alone.
 * - http(s) URLs (uploaded clips streamed from the server) use a standard
 *   `Range` header against the same-origin stream endpoint.
 *
 * Shared by the editor's preview engine, the render pipeline, and the
 * filmstrip sampler.
 */
export function createCaptureSource(mediaUrl: string): CustomSource {
  const isHttp = /^https?:\/\//i.test(mediaUrl)
  const fetchRange = async (
    startByte: number,
    endByte: number,
  ): Promise<Response> => {
    let response: Response
    if (isHttp) {
      response = await fetch(mediaUrl, {
        headers: { Range: `bytes=${startByte}-${endByte}` },
      })
    } else {
      const url = new URL(mediaUrl)
      url.searchParams.set("range", `${startByte}-${endByte}`)
      response = await fetch(url)
    }
    if (!response.ok) {
      throw new Error(`Capture media request failed (HTTP ${response.status})`)
    }
    return response
  }

  let sizePromise: Promise<number> | null = null
  return new CustomSource({
    getSize: () => {
      sizePromise ??= (async () => {
        const response = await fetchRange(0, 0)
        const total = Number(
          response.headers.get("Content-Range")?.split("/")[1],
        )
        if (!Number.isFinite(total) || total <= 0) {
          throw new Error("Capture size unavailable")
        }
        return total
      })()
      return sizePromise
    },
    // Mediabunny's `end` is exclusive; the protocol's range is inclusive.
    read: async (start, end) => {
      const response = await fetchRange(start, Math.max(start, end - 1))
      return new Uint8Array(await response.arrayBuffer())
    },
    prefetchProfile: "network",
  })
}
