import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"

import type { OAuthProviderConfig } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { SECRETS_PATH } from "@alloy/server/runtime/dirs"
import { errorDetail } from "@alloy/server/runtime/error-message"
import { dirname } from "@alloy/server/runtime/path"

import { type ServerSecrets, ServerSecretsSchema } from "./schema"

const logger = createLogger("secret-store")

/**
 * Server-only secret store. Holds all secret material (cookie/HMAC keys, the
 * SteamGridDB key, and OAuth client secrets) in `secrets.json`, kept apart from
 * the runtime config so that no config read path — `getAll()`, `export`, an
 * accidentally-added endpoint — can ever serialize a secret. Mirrors the
 * atomic-write machinery of the config store.
 */

function writeToDisk(next: ServerSecrets): void {
  mkdirSync(dirname(SECRETS_PATH), { recursive: true })
  // Atomic: tmp + rename survives process death mid-write.
  const tmpPath = `${SECRETS_PATH}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`)
  renameSync(tmpPath, SECRETS_PATH)
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
      logger.error(`cannot read ${SECRETS_PATH}:`, err)
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
        `${SECRETS_PATH} is not valid JSON; refusing to start ` +
          `to avoid destroying existing secrets:`,
        errorDetail(err, ""),
      )
      process.exit(1)
    }
    const result = ServerSecretsSchema.safeParse(parsed)
    if (!result.success) {
      logger.error(
        `${SECRETS_PATH} failed validation:`,
        JSON.stringify(result.error.flatten()),
      )
      process.exit(1)
    }
    // Re-persist only when parsing actually changed content (filled defaults),
    // compared order-insensitively so key ordering alone never forces a rewrite.
    const persist = stableStringify(result.data) !== stableStringify(parsed)
    return { secrets: result.data, persist }
  }

  return {
    secrets: ServerSecretsSchema.parse({}),
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
  setStorageS3Credentials(input: {
    accessKeyId?: string
    secretAccessKey?: string
  }): void {
    commit({
      ...state,
      storageS3AccessKeyId:
        input.accessKeyId !== undefined
          ? input.accessKeyId
          : state.storageS3AccessKeyId,
      storageS3SecretAccessKey:
        input.secretAccessKey !== undefined
          ? input.secretAccessKey
          : state.storageS3SecretAccessKey,
    })
  },
  storageS3Credentials(): {
    accessKeyId: string
    secretAccessKey: string
  } | null {
    if (!state.storageS3AccessKeyId || !state.storageS3SecretAccessKey) {
      return null
    }
    return {
      accessKeyId: state.storageS3AccessKeyId,
      secretAccessKey: state.storageS3SecretAccessKey,
    }
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
