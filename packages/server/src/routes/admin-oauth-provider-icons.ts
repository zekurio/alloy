import { randomUUID } from "node:crypto"

import {
  managedOAuthProviderIconKey,
  OAUTH_PROVIDER_ICON_KEY_RE,
  oauthProviderIconPath,
  type OAuthProviderConfig,
} from "@alloy/contracts"
import {
  fetchOAuthProviderIconFromUrl,
  OAUTH_PROVIDER_ICON_CONTENT_TYPE,
  oauthProviderIconKey,
  prepareOAuthProviderIcon,
  type PreparedOAuthProviderIcon,
} from "@alloy/server/auth/oauth-provider-icons"
import { setOAuthProviders } from "@alloy/server/config/store"
import { db } from "@alloy/server/db/index"
import { prewriteAssetDeletionIntent } from "@alloy/server/storage/deletion-producers"
import {
  enqueueStorageDeletion,
  enqueueStorageDeletions,
} from "@alloy/server/storage/deletion-store"
import { wakeStorageDeletionWorker } from "@alloy/server/storage/deletion-worker"
import { assetStorage } from "@alloy/server/storage/index"
import { withStorageObjectWriteActivity } from "@alloy/server/storage/write-activity"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import { immutableImageAssetsRoute } from "./immutable-image-assets"

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
  // Injectable for tests: the real fetcher performs network I/O behind the
  // SSRF guard, which (correctly) refuses the loopback hosts tests can bind.
  fetchIcon: (
    url: string,
  ) => Promise<PreparedOAuthProviderIcon> = fetchOAuthProviderIconFromUrl,
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

    const prepared = await fetchIcon(iconUrl)
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
export async function writeOAuthProviderIcon(
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

export const oauthProviderIconAssetsRoute = immutableImageAssetsRoute(
  assetStorage,
  OAUTH_PROVIDER_ICON_KEY_RE,
)
