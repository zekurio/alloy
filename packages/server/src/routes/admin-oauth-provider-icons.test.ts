import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  AdminRuntimeConfigSchema,
  managedOAuthProviderIconKey,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import {
  authAccount,
  authSession,
  user,
  userPasskey,
} from "@alloy/db/auth-schema"
import { instanceSetting, storageDeletion } from "@alloy/db/schema"
import { OAUTH_PROVIDER_ICON_MAX_BYTES } from "@alloy/server/auth/oauth-provider-icons"
import { and, eq, inArray, like } from "drizzle-orm"
import sharp from "sharp"
import { test } from "vitest"

test.skipIf(!process.env.ALLOY_TEST_DATABASE_URL)(
  "admin OAuth provider icons ingest, serve, replace, and clean up through storage",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "alloy-oauth-icon-"))
    process.env.NODE_ENV = "production"
    process.env.DATABASE_URL = process.env.ALLOY_TEST_DATABASE_URL
    process.env.PUBLIC_SERVER_URL = "https://alloy.example"
    process.env.ALLOY_VIEWER_COOKIE_SECRET = "v".repeat(32)
    process.env.ALLOY_UPLOAD_HMAC_SECRET = "u".repeat(32)
    process.env.ALLOY_STEAMGRIDDB_API_KEY = "steamgriddb-key"
    process.env.ALLOY_STORAGE_FS_CLIPS_PATH = join(directory, "clips")
    process.env.ALLOY_STORAGE_FS_THUMBNAILS_PATH = join(directory, "thumbnails")
    process.env.ALLOY_STORAGE_FS_ASSETS_PATH = join(directory, "assets")
    delete process.env.ALLOY_SOCIALACCOUNT_PROVIDERS

    const { db, client } = await import("@alloy/server/db/index")
    const { initializeConfigStore, setOAuthProviders, configStore } =
      await import("@alloy/server/config/store")
    const { hashSessionToken } = await import("@alloy/server/auth/tokens")
    const { adminRoute } = await import("./admin")
    const { ingestSubmittedOAuthProviderIcons, oauthProviderIconAssetsRoute } =
      await import("./admin-oauth-provider-icons")
    const { assetStorage } = await import("@alloy/server/storage/index")
    const { getPublicProviders } =
      await import("@alloy/server/auth/oauth-config")

    const adminId = randomUUID()
    const token = randomUUID()
    const providerId = `acme-${adminId.slice(0, 8)}`
    const headers = { Cookie: `alloy_access=${token}` }
    const provider = {
      providerId,
      displayName: "Acme",
      clientId: "alloy",
      enabled: true,
      discoveryUrl: "https://idp.example/.well-known/openid-configuration",
    }

    const putProviders = (providers: unknown[]) =>
      adminRoute.request("/oauth-providers", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ providers }),
      })

    const iconKeyOf = async (response: Response) => {
      const config = AdminRuntimeConfigSchema.parse(await response.json())
      const saved = config.oauthProviders.find(
        (candidate) => candidate.providerId === providerId,
      )
      return {
        iconUrl: saved?.iconUrl,
        key: managedOAuthProviderIconKey(saved?.iconUrl),
        clientSecret: saved?.clientSecret,
      }
    }

    const pendingDeletion = async (key: string) => {
      const rows = await db
        .select({ reason: storageDeletion.reason })
        .from(storageDeletion)
        .where(
          and(
            eq(storageDeletion.namespace, "assets"),
            eq(storageDeletion.storage_key, key),
          ),
        )
      return rows[0] ?? null
    }

    try {
      await db.insert(user).values({
        id: adminId,
        username: `icon-admin-${adminId}`,
        role: "admin",
      })
      // Passkeys keep an admin sign-in method available, so provider edits
      // pass the lockout guard.
      await db.insert(userPasskey).values({
        user_id: adminId,
        credential_id: `cred-${adminId}`,
        public_key: "pk",
        device_type: "singleDevice",
      })
      await db.insert(authSession).values({
        user_id: adminId,
        token_hash: await hashSessionToken(token),
        expires_at: new Date(Date.now() + 60_000),
      })
      await initializeConfigStore()

      // Create the provider before attaching its uploaded icon.
      const created = await putProviders([
        {
          ...provider,
          clientSecret: "s3cret-value",
        },
      ])
      assert.equal(created.status, 200, await created.clone().text())
      const createdProvider = await iconKeyOf(created)
      assert.equal(createdProvider.clientSecret, undefined)
      assert.equal(createdProvider.iconUrl, undefined)
      assert.equal(createdProvider.key, null)

      // An icon source URL resolving to a private address is refused at the
      // HTTP boundary before any fetch happens (SSRF guard).
      const ssrf = await putProviders([
        { ...provider, iconUrl: "http://10.0.0.8/icon.png" },
      ])
      assert.equal(ssrf.status, 400)
      assert.match(
        t.looseObject({ error: t.string() }).parse(await ssrf.json()).error,
        /public address/,
      )
      const dataUri = await putProviders([
        { ...provider, iconUrl: "data:image/png;base64,AAAA" },
      ])
      assert.equal(dataUri.status, 400)
      assert.match(
        t.looseObject({ error: t.string() }).parse(await dataUri.json()).error,
        /http or https/,
      )

      // Attach an icon through direct file upload: managed flow end to end.
      const upload = new FormData()
      upload.set(
        "file",
        new File(
          [
            new Uint8Array(
              await sharp({
                create: {
                  width: 32,
                  height: 32,
                  channels: 3,
                  background: "green",
                },
              })
                .png()
                .toBuffer(),
            ),
          ],
          "icon.png",
          { type: "image/png" },
        ),
      )
      const uploaded = await adminRoute.request(
        `/oauth-providers/${providerId}/icon`,
        { method: "POST", headers, body: upload },
      )
      assert.equal(uploaded.status, 200, await uploaded.clone().text())
      const first = await iconKeyOf(uploaded)
      assert.ok(first.key, `expected managed icon, got ${first.iconUrl}`)
      assert.ok(first.key.startsWith(`providers/${providerId}/icon-`))
      // The prewrite reservation was cancelled when the config claimed the key.
      assert.equal(await pendingDeletion(first.key), null)

      // Served same-origin with immutable caching.
      const served = await oauthProviderIconAssetsRoute.request(`/${first.key}`)
      assert.equal(served.status, 200)
      assert.equal(served.headers.get("Content-Type"), "image/webp")
      assert.match(served.headers.get("Cache-Control") ?? "", /immutable/)

      // The public auth config only ever exposes the same-origin path.
      const publicProvider = getPublicProviders().find(
        (candidate) => candidate.providerId === providerId,
      )
      assert.equal(publicProvider?.iconUrl, first.iconUrl)

      // Resubmitting the list with the managed path (as the admin UI does)
      // keeps the icon and enqueues nothing.
      const resaved = await putProviders([
        { ...provider, iconUrl: first.iconUrl },
      ])
      assert.equal(resaved.status, 200, await resaved.clone().text())
      assert.equal((await iconKeyOf(resaved)).key, first.key)
      assert.equal(await pendingDeletion(first.key), null)

      // URL ingestion (with the download step injected) rewrites the provider
      // to a fresh managed key and the config write both claims the new key
      // and enqueues deletion of the displaced one.
      const ingestion = await ingestSubmittedOAuthProviderIcons(
        [
          {
            ...configStore.get("oauthProviders")[0],
            iconUrl: "https://icons.example/acme.png",
          },
        ],
        async () => ({
          ok: true,
          bytes: await sharp({
            create: { width: 48, height: 48, channels: 4, background: "#123" },
          })
            .webp()
            .toBuffer(),
        }),
      )
      assert.ok(ingestion.ok, "ingestion failed")
      const secondKey = managedOAuthProviderIconKey(
        ingestion.providers[0]?.iconUrl,
      )
      assert.ok(secondKey)
      assert.notEqual(secondKey, first.key)
      // Written but not yet referenced: the prewrite reservation is pending.
      assert.ok(await pendingDeletion(secondKey))
      const saveResult = await setOAuthProviders(ingestion.providers, {})
      assert.equal(saveResult.queuedIconDeletions, 1)
      assert.equal(await pendingDeletion(secondKey), null)
      assert.match(
        (await pendingDeletion(first.key))?.reason ?? "",
        /no longer referenced/,
      )
      assert.ok(await assetStorage.resolve(secondKey))

      // Uploading to an unknown provider is a 404, not a config write.
      const missing = await adminRoute.request(
        `/oauth-providers/never-configured/icon`,
        { method: "POST", headers, body: upload },
      )
      assert.equal(missing.status, 404)

      // A junk file is rejected by content validation.
      const junkForm = new FormData()
      junkForm.set(
        "file",
        new File([new TextEncoder().encode("not an image")], "icon.png", {
          type: "image/png",
        }),
      )
      const junk = await adminRoute.request(
        `/oauth-providers/${providerId}/icon`,
        { method: "POST", headers, body: junkForm },
      )
      assert.equal(junk.status, 400)

      // Reject oversized multipart bodies before buffering the file in the
      // handler.
      const oversizedForm = new FormData()
      oversizedForm.set(
        "file",
        new File(
          [new Uint8Array(OAUTH_PROVIDER_ICON_MAX_BYTES + 16 * 1024 + 1)],
          "oversized.png",
          { type: "image/png" },
        ),
      )
      const oversized = await adminRoute.request(
        `/oauth-providers/${providerId}/icon`,
        { method: "POST", headers, body: oversizedForm },
      )
      assert.equal(oversized.status, 413)

      await db.insert(authAccount).values({
        user_id: adminId,
        provider_id: providerId,
        provider_account_id: `account-${adminId}`,
      })

      // Deleting the provider removes its account links and enqueues deletion
      // of its managed icon in the same config transaction.
      const removed = await putProviders([])
      assert.equal(removed.status, 200, await removed.clone().text())
      const linkedAccounts = await db
        .select({ id: authAccount.id })
        .from(authAccount)
        .where(eq(authAccount.provider_id, providerId))
      assert.deepEqual(linkedAccounts, [])
      assert.match(
        (await pendingDeletion(secondKey))?.reason ?? "",
        /no longer referenced/,
      )
    } finally {
      await db.delete(user).where(eq(user.id, adminId))
      await db
        .delete(instanceSetting)
        .where(
          inArray(instanceSetting.key, [
            "oauthProviders",
            "oauthClientSecrets",
          ]),
        )
      await db
        .delete(storageDeletion)
        .where(
          like(storageDeletion.storage_key, `providers/${providerId}/icon-%`),
        )
      await client.end()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
