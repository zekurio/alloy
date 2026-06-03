import { logger } from "@workspace/logging"

import { errorDetail } from "../runtime/error-message"
import { CONFIG_PATH, SECRETS_PATH } from "../runtime/dirs"
import { dirname } from "../runtime/path"
import { type ServerSecrets, ServerSecretsSchema } from "./schema"

/**
 * Server-only secret store. Holds all secret material (cookie/HMAC keys, the
 * SteamGridDB key, and OAuth client secrets) in `secrets.json`, kept apart from
 * the runtime config so that no config read path — `getAll()`, `export`, an
 * accidentally-added endpoint — can ever serialize a secret. Mirrors the
 * atomic-write machinery of the config store.
 */

function readJsonFile(path: string): unknown | null {
  try {
    if (!Deno.statSync(path).isFile) return null
  } catch {
    return null
  }
  try {
    return JSON.parse(Deno.readTextFileSync(path))
  } catch (err) {
    logger.warn(`[secret-store] could not parse ${path}:`, errorDetail(err, ""))
    return null
  }
}

function writeToDisk(next: ServerSecrets): void {
  Deno.mkdirSync(dirname(SECRETS_PATH), { recursive: true })
  // Atomic: tmp + rename survives process death mid-write.
  const tmpPath = `${SECRETS_PATH}.tmp`
  Deno.writeTextFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`)
  Deno.renameSync(tmpPath, SECRETS_PATH)
}

/**
 * Extract secrets that older configs stored inline in `config.json`, so an
 * existing deployment keeps working across the split. The config store strips
 * these legacy keys on its next parse+rewrite.
 */
function seedFromLegacyConfig(): Partial<ServerSecrets> {
  const raw = readJsonFile(CONFIG_PATH)
  if (!raw || typeof raw !== "object") return {}
  const config = raw as Record<string, unknown>

  const seed: Record<string, unknown> = {}
  const legacySecrets = config.secrets
  if (legacySecrets && typeof legacySecrets === "object") {
    const s = legacySecrets as Record<string, unknown>
    if (typeof s.viewerCookieSecret === "string") {
      seed.viewerCookieSecret = s.viewerCookieSecret
    }
    if (typeof s.uploadHmacSecret === "string") {
      seed.uploadHmacSecret = s.uploadHmacSecret
    }
  }
  const legacyIntegrations = config.integrations
  if (legacyIntegrations && typeof legacyIntegrations === "object") {
    const key =
      (legacyIntegrations as Record<string, unknown>).steamgriddbApiKey
    if (typeof key === "string") seed.steamgriddbApiKey = key
  }
  if (Array.isArray(config.oauthProviders)) {
    const oauthClientSecrets: Record<string, string> = {}
    for (const provider of config.oauthProviders) {
      if (!provider || typeof provider !== "object") continue
      const row = provider as Record<string, unknown>
      if (
        typeof row.providerId === "string" &&
        typeof row.clientSecret === "string" &&
        row.clientSecret.length > 0
      ) {
        oauthClientSecrets[row.providerId] = row.clientSecret
      }
    }
    if (Object.keys(oauthClientSecrets).length > 0) {
      seed.oauthClientSecrets = oauthClientSecrets
    }
  }
  return seed as Partial<ServerSecrets>
}

function loadInitialSecrets(): { secrets: ServerSecrets; persist: boolean } {
  const onDisk = readJsonFile(SECRETS_PATH)
  if (onDisk) {
    const parsed = ServerSecretsSchema.safeParse(onDisk)
    if (parsed.success) {
      // Re-persist only if parsing filled in defaults (shape changed on disk).
      const persist = JSON.stringify(parsed.data) !== JSON.stringify(onDisk)
      return { secrets: parsed.data, persist }
    }
    logger.error(
      `[secret-store] ${SECRETS_PATH} failed validation:`,
      JSON.stringify(parsed.error.flatten()),
    )
    Deno.exit(1)
  }

  // First boot after the split (or a fresh install): seed from any legacy
  // inline config secrets, then generate the rest from schema defaults.
  return {
    secrets: ServerSecretsSchema.parse(seedFromLegacyConfig()),
    persist: true,
  }
}

const initial = loadInitialSecrets()
let state: ServerSecrets = initial.secrets
if (initial.persist) writeToDisk(state)

function commit(next: ServerSecrets): void {
  state = ServerSecretsSchema.parse(next)
  writeToDisk(state)
}

export const secretStore = {
  get<K extends keyof ServerSecrets>(key: K): ServerSecrets[K] {
    return state[key]
  },
  /** Resolve an OAuth client secret by provider id ("" when unset). */
  oauthClientSecret(providerId: string): string {
    return state.oauthClientSecrets[providerId] ?? ""
  },
  hasOAuthClientSecret(providerId: string): boolean {
    return (state.oauthClientSecrets[providerId] ?? "").length > 0
  },
  setOAuthClientSecret(providerId: string, secret: string): void {
    commit({
      ...state,
      oauthClientSecrets: { ...state.oauthClientSecrets, [providerId]: secret },
    })
  },
  /** Drop secrets for providers that no longer exist. */
  retainOAuthProviders(providerIds: Iterable<string>): void {
    const keep = new Set(providerIds)
    const next: Record<string, string> = {}
    for (const [id, secret] of Object.entries(state.oauthClientSecrets)) {
      if (keep.has(id)) next[id] = secret
    }
    commit({ ...state, oauthClientSecrets: next })
  },
  setSteamgriddbApiKey(key: string): void {
    commit({ ...state, steamgriddbApiKey: key })
  },
  /**
   * Merge admin-managed secrets (OAuth client secrets, SteamGridDB key) that a
   * reloaded or hand-edited config.json carried inline, so a restore/edit keeps
   * working. Server-internal secrets (cookie/upload HMAC) are never touched
   * here, and it's a no-op when nothing inline is present (avoids churn on the
   * watcher's self-triggered reloads).
   */
  ingestConfigSecrets(raw: unknown = readJsonFile(CONFIG_PATH)): void {
    if (!raw || typeof raw !== "object") return
    const config = raw as Record<string, unknown>

    let changed = false
    const oauthClientSecrets = { ...state.oauthClientSecrets }
    if (Array.isArray(config.oauthProviders)) {
      for (const provider of config.oauthProviders) {
        if (!provider || typeof provider !== "object") continue
        const row = provider as Record<string, unknown>
        if (
          typeof row.providerId === "string" &&
          typeof row.clientSecret === "string" &&
          row.clientSecret.length > 0 &&
          oauthClientSecrets[row.providerId] !== row.clientSecret
        ) {
          oauthClientSecrets[row.providerId] = row.clientSecret
          changed = true
        }
      }
    }

    let steamgriddbApiKey = state.steamgriddbApiKey
    const integrations = config.integrations
    if (integrations && typeof integrations === "object") {
      const key = (integrations as Record<string, unknown>).steamgriddbApiKey
      if (
        typeof key === "string" && key.length > 0 && key !== steamgriddbApiKey
      ) {
        steamgriddbApiKey = key
        changed = true
      }
    }

    if (changed) commit({ ...state, oauthClientSecrets, steamgriddbApiKey })
  },
} as const

// On every boot, migrate inline admin-managed secrets that a restored or
// hand-edited config.json carries BEFORE the config store strips those keys and
// rewrites the file. No-op when secrets.json was just seeded from the same file
// above; this covers the case where secrets.json already existed (so the seed
// path was skipped) but config.json was restored with inline secrets.
secretStore.ingestConfigSecrets()
