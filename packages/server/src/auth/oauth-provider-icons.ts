import { Buffer } from "node:buffer"
import { randomUUID } from "node:crypto"

import {
  managedOAuthProviderIconKey,
  oauthProviderIconPath,
  type OAuthProviderConfig,
} from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { configStore, setOAuthProviders } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import {
  MAX_IMAGE_PIXELS,
  parseImageBytes,
} from "@alloy/server/media/image-validation"
import {
  fetchRemoteImage,
  resolvesToPublicAddress,
} from "@alloy/server/media/remote-image"
import { errorMessage } from "@alloy/server/runtime/error-message"
import { prewriteAssetDeletionIntent } from "@alloy/server/storage/deletion-producers"
import {
  enqueueStorageDeletion,
  enqueueStorageDeletions,
} from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { assetStorage } from "@alloy/server/storage/index"
import { withStorageObjectWriteActivity } from "@alloy/server/storage/write-activity"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import sharp from "sharp"

const logger = createLogger("oauth-provider-icons")

const OAUTH_PROVIDER_ICON_CONTENT_TYPE = "image/webp"

// Login-button icons render at ~16-32 px; 128 px keeps them crisp on HiDPI
// displays while keeping the stored objects tiny.
const ICON_TARGET_PX = 128
// Rasterize SVG sources well above the target so downscaling stays sharp.
const SVG_RASTER_DENSITY = 300

const PROVIDER_ID_RE = /^[a-z0-9-]{1,64}$/

function oauthProviderIconKey(providerId: string, versionId: string): string {
  if (!PROVIDER_ID_RE.test(providerId)) {
    throw new Error("Provider id must be lowercase letters, digits, or dashes")
  }
  const version = versionId.replaceAll("-", "").toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(version)) {
    throw new Error("Icon version must be a UUID")
  }
  return `providers/${providerId}/icon-${version}.webp`
}

type PreparedOAuthProviderIcon =
  | { ok: true; bytes: Buffer }
  | { ok: false; status: ContentfulStatusCode; error: string }

/**
 * Validate icon bytes by content (raster magic bytes or an SVG document) and
 * normalize every source into a small webp, so stored icons carry no
 * metadata, scripts, or oversized payloads regardless of origin.
 */
async function prepareOAuthProviderIcon(
  input: Uint8Array,
): Promise<PreparedOAuthProviderIcon> {
  const maxBytes = configStore.get("uploadLimits").oauthProviderIconMaxBytes
  const bytes = Buffer.from(input)
  if (bytes.byteLength === 0) {
    return { ok: false, status: 400, error: "Empty image data" }
  }
  if (bytes.byteLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `Icon too large. Max ${maxBytes / 1024 / 1024} MB`,
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
async function fetchOAuthProviderIconFromUrl(
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
      maxBytes: configStore.get("uploadLimits").oauthProviderIconMaxBytes,
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

// The active-write fence provides correctness. This short delay merely avoids
// waking the worker during the normal small-icon ingest/attach path.
const PREWRITE_DELETION_DELAY_MS = 60 * 1000

interface WrittenIcon {
  key: string
  attemptId: string
}

export type OAuthProviderIconIngestion =
  | { ok: true; providers: OAuthProviderConfig[]; newIcons: WrittenIcon[] }
  | { ok: false; status: ContentfulStatusCode; error: string }

/**
 * Ingest every submitted external icon URL into managed asset storage and
 * rewrite the provider's iconUrl to the same-origin path. Managed paths pass
 * through untouched. Anything else is rejected.
 *
 * Written objects carry delayed prewrite deletion reservations; the follow-up
 * setOAuthProviders call cancels them once the config references the keys. On
 * failure the caller must abandon the ingestion.
 */
export async function ingestSubmittedOAuthProviderIcons(
  providers: OAuthProviderConfig[],
): Promise<OAuthProviderIconIngestion> {
  const next: OAuthProviderConfig[] = []
  const newIcons: WrittenIcon[] = []
  for (const provider of providers) {
    const iconUrl = provider.iconUrl
    if (
      iconUrl === undefined ||
      managedOAuthProviderIconKey(iconUrl) !== null
    ) {
      next.push(provider)
      continue
    }

    const prepared = await fetchOAuthProviderIconFromUrl(iconUrl)
    if (!prepared.ok) {
      await abandonIngestedOAuthProviderIcons(
        newIcons,
        "provider icon ingestion failed",
      )
      return {
        ok: false,
        status: prepared.status,
        error: `${provider.providerId}: ${prepared.error}`,
      }
    }

    let written: WrittenIcon
    try {
      written = await writeOAuthProviderIcon(provider.providerId, prepared)
    } catch (cause) {
      await abandonIngestedOAuthProviderIcons(
        newIcons,
        "provider icon ingestion failed",
      )
      throw cause
    }
    newIcons.push(written)
    next.push({ ...provider, iconUrl: oauthProviderIconPath(written.key) })
  }
  return { ok: true, providers: next, newIcons }
}

/**
 * Reserve-then-write a processed icon. The delayed reservation guarantees the
 * object cannot leak if the config write never happens.
 */
async function writeOAuthProviderIcon(
  providerId: string,
  prepared: Extract<PreparedOAuthProviderIcon, { ok: true }>,
): Promise<WrittenIcon> {
  const attemptId = randomUUID()
  const key = oauthProviderIconKey(providerId, attemptId)
  await withStorageObjectWriteActivity("assets", key, async () => {
    await enqueueStorageDeletion(
      prewriteAssetDeletionIntent({ key, attemptId }),
      { runAt: new Date(Date.now() + PREWRITE_DELETION_DELAY_MS) },
    )
    await assetStorage.put(
      key,
      prepared.bytes,
      OAUTH_PROVIDER_ICON_CONTENT_TYPE,
    )
  })
  return { key, attemptId }
}

/** Make written-but-unreferenced icon objects due for deletion right away. */
export async function abandonIngestedOAuthProviderIcons(
  written: readonly WrittenIcon[],
  reason: string,
): Promise<void> {
  if (written.length === 0) return
  await db.transaction(async (tx) => {
    await enqueueStorageDeletions(
      written.map((icon) => prewriteAssetDeletionIntent({ ...icon, reason })),
      { tx, runAt: new Date() },
    )
  })
  wakeStorageDeletionWorker()
}

export type OAuthProviderIconUploadResult =
  | { ok: true }
  | { ok: false; status: ContentfulStatusCode; error: string }

/**
 * Attach an admin-uploaded icon file to a stored provider: process the bytes,
 * write the versioned object, and persist the provider list with the new
 * managed iconUrl (which also queues deletion of the displaced icon).
 */
export async function uploadOAuthProviderIcon(
  providers: readonly OAuthProviderConfig[],
  providerId: string,
  file: File,
): Promise<OAuthProviderIconUploadResult> {
  const index = providers.findIndex(
    (provider) => provider.providerId === providerId,
  )
  if (index < 0) {
    return { ok: false, status: 404, error: "Unknown OAuth provider" }
  }

  const prepared = await prepareOAuthProviderIcon(
    new Uint8Array(await file.arrayBuffer()),
  )
  if (!prepared.ok) return prepared

  const written = await writeOAuthProviderIcon(providerId, prepared)
  let queuedIconDeletions = 0
  try {
    ;({ queuedIconDeletions } = await setOAuthProviders(
      providers.map((provider, current) =>
        current === index
          ? { ...provider, iconUrl: oauthProviderIconPath(written.key) }
          : provider,
      ),
      {},
    ))
  } catch (cause) {
    await abandonIngestedOAuthProviderIcons(
      [written],
      "provider icon upload failed",
    )
    throw cause
  }
  if (queuedIconDeletions > 0) wakeStorageDeletionWorker()
  return { ok: true }
}
