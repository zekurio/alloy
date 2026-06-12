import type { StorageDriver } from "@alloy/server/storage/index"
import type { Context } from "hono"

/**
 * TTL for browser-bound storage GET URLs. Long enough that a paused
 * playback session can resume; redirect responses must cache for less
 * than this so a cached Location never outlives its signature.
 */
export const DIRECT_MEDIA_URL_TTL_SEC = 6 * 60 * 60

/** Longest a redirect response may be cached — half the URL TTL, so a
 * Location served from cache always has at least that long to live. */
export const DIRECT_MEDIA_REDIRECT_MAX_AGE_SEC = DIRECT_MEDIA_URL_TTL_SEC / 2

/**
 * Serve an object by redirecting the client to a storage-signed URL, so
 * the bytes flow from the store (S3/R2) instead of through this server.
 * Returns `null` when the driver has no direct URLs (fs) or the request
 * is not a plain GET — presigned URLs sign the HTTP method, so a GET URL
 * cannot answer HEAD. Callers fall back to proxy streaming.
 */
export async function redirectToStorageUrl(
  c: Context,
  driver: StorageDriver,
  input: { key: string; contentType?: string; contentDisposition?: string },
  cacheControl: string,
): Promise<Response | null> {
  if (c.req.method !== "GET") return null
  const url = await driver.mintDownloadUrl({
    ...input,
    expiresInSec: DIRECT_MEDIA_URL_TTL_SEC,
  })
  if (!url) return null
  c.header("Cache-Control", cacheControl)
  return c.redirect(url, 302)
}
