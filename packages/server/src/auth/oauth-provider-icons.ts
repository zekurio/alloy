import { Buffer } from "node:buffer"

import { createLogger } from "@alloy/logging"
import {
  MAX_IMAGE_PIXELS,
  parseImageBytes,
} from "@alloy/server/media/image-validation"
import {
  fetchRemoteImage,
  resolvesToPublicAddress,
} from "@alloy/server/media/remote-image"
import { errorMessage } from "@alloy/server/runtime/error-message"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import sharp from "sharp"

const logger = createLogger("oauth-provider-icons")

export const OAUTH_PROVIDER_ICON_MAX_BYTES = 2 * 1024 * 1024 // 2 MB
export const OAUTH_PROVIDER_ICON_CONTENT_TYPE = "image/webp"

// Login-button icons render at ~16-32 px; 128 px keeps them crisp on HiDPI
// displays while keeping the stored objects tiny.
const ICON_TARGET_PX = 128
// Rasterize SVG sources well above the target so downscaling stays sharp.
const SVG_RASTER_DENSITY = 300

const PROVIDER_ID_RE = /^[a-z0-9-]{1,64}$/

export function oauthProviderIconKey(
  providerId: string,
  versionId: string,
): string {
  if (!PROVIDER_ID_RE.test(providerId)) {
    throw new Error("Provider id must be lowercase letters, digits, or dashes")
  }
  const version = versionId.replaceAll("-", "").toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(version)) {
    throw new Error("Icon version must be a UUID")
  }
  return `providers/${providerId}/icon-${version}.webp`
}

export type PreparedOAuthProviderIcon =
  | { ok: true; bytes: Buffer }
  | { ok: false; status: ContentfulStatusCode; error: string }

/**
 * Validate icon bytes by content (raster magic bytes or an SVG document) and
 * normalize every source into a small webp, so stored icons carry no
 * metadata, scripts, or oversized payloads regardless of origin.
 */
export async function prepareOAuthProviderIcon(
  input: Uint8Array,
): Promise<PreparedOAuthProviderIcon> {
  const bytes = Buffer.from(input)
  if (bytes.byteLength === 0) {
    return { ok: false, status: 400, error: "Empty image data" }
  }
  if (bytes.byteLength > OAUTH_PROVIDER_ICON_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Icon too large. Max ${OAUTH_PROVIDER_ICON_MAX_BYTES / 1024 / 1024} MB`,
    }
  }

  const raster = parseImageBytes(bytes)
  const svg = raster === null && looksLikeSvg(bytes)
  if (!raster && !svg) {
    return { ok: false, status: 400, error: "Unsupported or invalid image" }
  }
  if (raster && raster.width * raster.height > MAX_IMAGE_PIXELS) {
    return { ok: false, status: 400, error: "Image dimensions are too large" }
  }

  try {
    const processed = await sharp(
      bytes,
      svg
        ? { density: SVG_RASTER_DENSITY, limitInputPixels: MAX_IMAGE_PIXELS }
        : { limitInputPixels: MAX_IMAGE_PIXELS },
    )
      .rotate()
      .resize(ICON_TARGET_PX, ICON_TARGET_PX, {
        fit: "inside",
        // SVGs rasterize at an arbitrary density, so scaling to the target is
        // always correct; rasters should never be enlarged.
        withoutEnlargement: !svg,
      })
      .webp()
      .toBuffer()
    return { ok: true, bytes: processed }
  } catch (cause) {
    logger.error("failed to process provider icon:", cause)
    return { ok: false, status: 400, error: "Could not process image" }
  }
}

/**
 * SSRF-guarded download of an admin-supplied icon source URL. Only http(s)
 * URLs resolving to public addresses are fetched; redirects are refused and
 * the response is size-bounded before content validation.
 */
export async function fetchOAuthProviderIconFromUrl(
  url: string,
): Promise<PreparedOAuthProviderIcon> {
  if (!URL.canParse(url)) {
    return { ok: false, status: 400, error: "Invalid icon URL" }
  }
  const parsed = new URL(url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      status: 400,
      error: "Icon URL must use http or https",
    }
  }
  if (!(await resolvesToPublicAddress(url))) {
    return {
      ok: false,
      status: 400,
      error: "Icon URL must resolve to a public address",
    }
  }

  let bytes: Buffer
  try {
    ;({ bytes } = await fetchRemoteImage(url, "provider icon", undefined, {
      redirect: "error",
      maxBytes: OAUTH_PROVIDER_ICON_MAX_BYTES,
    }))
  } catch (cause) {
    return {
      ok: false,
      status: 400,
      error: errorMessage(cause, "Could not download icon"),
    }
  }
  return prepareOAuthProviderIcon(bytes)
}

// Conservative SVG sniff: an optional XML prologue (declaration, comments,
// doctype) followed by an <svg> root element near the start of the document.
const SVG_PROLOGUE_RE =
  /^(?:\s|<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!doctype[^>]*>)*<svg[\s>]/i

function looksLikeSvg(bytes: Buffer): boolean {
  let text = bytes.subarray(0, 4096).toString("utf8")
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return SVG_PROLOGUE_RE.test(text)
}
