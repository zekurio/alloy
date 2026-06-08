import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs"

import type { OAuthProviderConfig } from "alloy-contracts"
import { logger } from "alloy-logging"

import { CONFIG_PATH, SECRETS_PATH } from "../runtime/dirs"
import { errorDetail } from "../runtime/error-message"
import { dirname } from "../runtime/path"
import { type ServerSecrets, ServerSecretsSchema } from "./schema"

/** Admin-managed secrets a config file may carry inline (legacy or restored). */
type InlineSecrets = {
  viewerCookieSecret?: string
  uploadHmacSecret?: string
  steamgriddbApiKey?: string
  oauthClientSecrets: Record<string, string>
}

export function readInlineSecrets(raw: unknown): InlineSecrets {
  const out: InlineSecrets = { oauthClientSecrets: {} }
  if (!raw || typeof raw !== "object") return out
  const config = raw as Record<string, unknown>

  const secrets = config.secrets
  if (secrets && typeof secrets === "object") {
    const s = secrets as Record<string, unknown>
    if (typeof s.viewerCookieSecret === "string") {
      out.viewerCookieSecret = s.viewerCookieSecret
    }
    if (typeof s.uploadHmacSecret === "string") {
      out.uploadHmacSecret = s.uploadHmacSecret
    }
  }
  const integrations = config.integrations
  if (integrations && typeof integrations === "object") {
    const key = (integrations as Record<string, unknown>).steamgriddbApiKey
    if (typeof key === "string" && key.length > 0) out.steamgriddbApiKey = key
  }
  if (Array.isArray(config.oauthProviders)) {
    for (const provider of config.oauthProviders) {
      if (!provider || typeof provider !== "object") continue
      const row = provider as Record<string, unknown>
      if (
        typeof row.providerId === "string" &&
        typeof row.clientSecret === "string" &&
        row.clientSecret.length > 0
      ) {
        out.oauthClientSecrets[row.providerId] = row.clientSecret
      }
    }
  }
  return out
}

/**
 * Server-only secret store. Holds all secret material (cookie/HMAC keys, the
 * SteamGridDB key, and OAuth client secrets) in `secrets.json`, kept apart from
 * the runtime config so that no config read path — `getAll()`, `export`, an
 * accidentally-added endpoint — can ever serialize a secret. Mirrors the
 * atomic-write machinery of the config store.
 */

function readJsonFile(path: string): unknown | null {
  try {
    if (!statSync(path).isFile()) return null
  } catch {
    return null
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (err) {
    logger.warn(`[secret-store] could not parse ${path}:`, errorDetail(err, ""))
    return null
  }
}

function writeToDisk(next: ServerSecrets): void {
  mkdirSync(dirname(SECRETS_PATH), { recursive: true })
  // Atomic: tmp + rename survives process death mid-write.
  const tmpPath = `${SECRETS_PATH}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`)
  renameSync(tmpPath, SECRETS_PATH)
}

/**
 * Extract secrets that older configs stored inline in `config.json` (including
 * the cookie/upload HMAC keys), so an existing deployment keeps working across
 * the split. The config store strips these legacy keys on its next rewrite.
 */
function seedFromLegacyConfig(): Partial<ServerSecrets> {
  const inline = readInlineSecrets(readJsonFile(CONFIG_PATH))
  const seed: Partial<ServerSecrets> = {}
  if (inline.viewerCookieSecret) {
    seed.viewerCookieSecret = inline.viewerCookieSecret
  }
  if (inline.uploadHmacSecret) seed.uploadHmacSecret = inline.uploadHmacSecret
  if (inline.steamgriddbApiKey) {
    seed.steamgriddbApiKey = inline.steamgriddbApiKey
  }
  if (Object.keys(inline.oauthClientSecrets).length > 0) {
    seed.oauthClientSecrets = inline.oauthClientSecrets
  }
  return seed
}

/** Order-insensitive structural compare, so key ordering doesn't force writes. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null"
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`
}

function loadInitialSecrets(): { secrets: ServerSecrets; persist: boolean } {
  let onDiskText: string | null = null
  try {
    onDiskText = readFileSync(SECRETS_PATH, "utf8")
  } catch (err) {
    if (!isNodeErrorCode(err, "ENOENT")) {
      // Unreadable (permissions, I/O): don't fall through to regeneration.
      logger.error(`[secret-store] cannot read ${SECRETS_PATH}:`, err)
      process.exit(1)
    }
  }

  if (onDiskText !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(onDiskText)
    } catch (err) {
      // Corrupt JSON: refuse to start rather than regenerate, which would
      // rotate the cookie/upload secrets (invalidating every session and
      // in-flight upload ticket) and drop all OAuth client secrets.
      logger.error(
        `[secret-store] ${SECRETS_PATH} is not valid JSON; refusing to start ` +
          `to avoid destroying existing secrets:`,
        errorDetail(err, ""),
      )
      process.exit(1)
    }
    const result = ServerSecretsSchema.safeParse(parsed)
    if (!result.success) {
      logger.error(
        `[secret-store] ${SECRETS_PATH} failed validation:`,
        JSON.stringify(result.error.flatten()),
      )
      process.exit(1)
    }
    // Re-persist only when parsing actually changed content (filled defaults),
    // compared order-insensitively so key ordering alone never forces a rewrite.
    const persist = stableStringify(result.data) !== stableStringify(parsed)
    return { secrets: result.data, persist }
  }

  // No secrets.json yet: seed from any legacy inline config secrets, then
  // generate the rest from schema defaults.
  return {
    secrets: ServerSecretsSchema.parse(seedFromLegacyConfig()),
    persist: true,
  }
}

function isNodeErrorCode(err: unknown, code: string): boolean {
  return (err as { code?: string } | null)?.code === code
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
  setSteamgriddbApiKey(key: string): void {
    commit({ ...state, steamgriddbApiKey: key })
  },
  /**
   * Apply a batch of secret changes in a single persisted write. `retainOAuth`
   * prunes client secrets to the given provider ids; `setOAuth` then overlays
   * new ones. Used by the OAuth save and config import so each rewrites
   * secrets.json exactly once instead of per-provider.
   */
  update(input: {
    setOAuth?: Record<string, string>
    setSteamgriddbApiKey?: string
    retainOAuth?: Iterable<string>
  }): void {
    let oauthClientSecrets: Record<string, string> = {
      ...state.oauthClientSecrets,
    }
    if (input.retainOAuth) {
      const keep = new Set(input.retainOAuth)
      oauthClientSecrets = Object.fromEntries(
        Object.entries(oauthClientSecrets).filter(([id]) => keep.has(id)),
      )
    }
    if (input.setOAuth) {
      for (const [id, secret] of Object.entries(input.setOAuth)) {
        oauthClientSecrets[id] = secret
      }
    }
    commit({
      ...state,
      oauthClientSecrets,
      steamgriddbApiKey: input.setSteamgriddbApiKey ?? state.steamgriddbApiKey,
    })
  },
  /**
   * Merge admin-managed secrets (OAuth client secrets, SteamGridDB key) that a
   * reloaded or hand-edited config.json carried inline, so a restore/edit keeps
   * working. Server-internal secrets (cookie/upload HMAC) are never touched
   * here, and it's a no-op when nothing inline is present (avoids churn on the
   * watcher's self-triggered reloads).
   */
  ingestConfigSecrets(raw: unknown = readJsonFile(CONFIG_PATH)): void {
    const inline = readInlineSecrets(raw)
    let changed = false
    const oauthClientSecrets = { ...state.oauthClientSecrets }
    for (const [id, secret] of Object.entries(inline.oauthClientSecrets)) {
      if (oauthClientSecrets[id] !== secret) {
        oauthClientSecrets[id] = secret
        changed = true
      }
    }
    let steamgriddbApiKey = state.steamgriddbApiKey
    if (
      inline.steamgriddbApiKey !== undefined &&
      inline.steamgriddbApiKey !== steamgriddbApiKey
    ) {
      steamgriddbApiKey = inline.steamgriddbApiKey
      changed = true
    }
    if (changed) commit({ ...state, oauthClientSecrets, steamgriddbApiKey })
  },
} as const

/**
 * The single rule for "is this OAuth provider actually usable for sign-in":
 * enabled AND a client secret is present. `pendingSecret` covers secrets about
 * to be written in the same request (validate-before-commit). Every path —
 * the consumer that serves providers, and the lockout guard that counts sign-in
 * methods — goes through this so the rule can't diverge.
 */
export function isOAuthProviderUsable(
  provider: Pick<OAuthProviderConfig, "providerId" | "enabled">,
  pendingSecret: (providerId: string) => boolean = () => false,
): boolean {
  return (
    provider.enabled &&
    (secretStore.hasOAuthClientSecret(provider.providerId) ||
      pendingSecret(provider.providerId))
  )
}

// On every boot, migrate inline admin-managed secrets that a restored or
// hand-edited config.json carries BEFORE the config store strips those keys and
// rewrites the file. No-op when secrets.json was just seeded from the same file
// above; this covers the case where secrets.json already existed (so the seed
// path was skipped) but config.json was restored with inline secrets.
secretStore.ingestConfigSecrets()
