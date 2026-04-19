import fs from "node:fs"
import path from "node:path"
import { z } from "zod"

import { env } from "../env"

/**
 * JSON-backed runtime config. Admin UI writes here; the on-disk file
 * survives restarts; subscribers are notified after each successful write
 * so `auth.ts` can rebuild the better-auth instance when the OAuth provider
 * changes without requiring a server restart.
 */

const ProviderIdPattern = /^[a-z0-9-]+$/

const OAuthProviderBaseSchema = z.object({
  /**
   * URL-safe slug used as better-auth's `providerId` — ends up in the
   * callback URL. Changing it after users have linked accounts breaks
   * those links, so pick something durable (e.g. "sso", "keycloak").
   */
  providerId: z
    .string()
    .min(1)
    .max(64)
    .regex(ProviderIdPattern, "lowercase letters, digits, and dashes only"),
  buttonText: z.string().min(1).max(128),
  clientId: z.string().min(1),
  clientSecret: z.string(),
  scopes: z.array(z.string().min(1)).optional(),
  discoveryUrl: z.string().url().optional(),
  authorizationUrl: z.string().url().optional(),
  tokenUrl: z.string().url().optional(),
  userInfoUrl: z.string().url().optional(),
  pkce: z.boolean().default(true),
})

const hasEndpoints = (p: z.infer<typeof OAuthProviderBaseSchema>) =>
  Boolean(p.discoveryUrl) ||
  (p.authorizationUrl && p.tokenUrl && p.userInfoUrl)

const endpointsMessage =
  "Provide discoveryUrl, or all three of authorizationUrl, tokenUrl, userInfoUrl."

/**
 * Storage schema — what we persist and hand to better-auth. A stored
 * provider must always carry a real client secret; empty is never valid
 * on disk.
 */
export const OAuthProviderSchema = OAuthProviderBaseSchema.extend({
  clientSecret: z.string().min(1),
}).refine(hasEndpoints, { message: endpointsMessage })

/**
 * Admin-submission schema — accepts an empty `clientSecret`, which the
 * route handler interprets as "keep the currently stored secret". Most
 * IdPs rotate secrets only occasionally, so re-entering one on every
 * settings change is a papercut.
 */
export const OAuthProviderSubmissionSchema = OAuthProviderBaseSchema.refine(
  hasEndpoints,
  { message: endpointsMessage },
)

export type OAuthProviderConfig = z.infer<typeof OAuthProviderSchema>
export type OAuthProviderSubmission = z.infer<
  typeof OAuthProviderSubmissionSchema
>

const RuntimeConfigSchema = z.object({
  openRegistrations: z.boolean().default(false),
  setupComplete: z.boolean().default(false),
  /**
   * Master switch for the email/password sign-in surface. When false the
   * login page hides the form and better-auth rejects both `/sign-in/email`
   * and `/sign-up/email`. Defaults to true so first-run setup keeps working
   * — admins can disable it once an OAuth provider is wired up and they
   * have themselves a linked OAuth account.
   */
  emailPasswordEnabled: z.boolean().default(true),
  oauthProvider: OAuthProviderSchema.nullable().default(null),
})

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>

const DEFAULT_CONFIG: RuntimeConfig = RuntimeConfigSchema.parse({})

function resolveConfigPath(): string {
  if (env.RUNTIME_CONFIG_PATH && env.RUNTIME_CONFIG_PATH.length > 0) {
    return path.resolve(env.RUNTIME_CONFIG_PATH)
  }
  return path.resolve(process.cwd(), "data/runtime-config.json")
}

const CONFIG_PATH = resolveConfigPath()

function loadFromDisk(): RuntimeConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG }
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8")
    const json = JSON.parse(raw) as unknown
    const result = RuntimeConfigSchema.safeParse(json)
    if (!result.success) {
      // eslint-disable-next-line no-console
      console.warn(
        `[config-store] ${CONFIG_PATH} failed validation, falling back to defaults:`,
        JSON.stringify(result.error.flatten()),
      )
      return { ...DEFAULT_CONFIG }
    }
    return result.data
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[config-store] failed to read ${CONFIG_PATH}, falling back to defaults:`,
      err instanceof Error ? err.message : err,
    )
    return { ...DEFAULT_CONFIG }
  }
}

function writeToDisk(next: RuntimeConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  // Atomic: tmp + rename survives process death mid-write.
  const tmpPath = `${CONFIG_PATH}.tmp`
  fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8")
  fs.renameSync(tmpPath, CONFIG_PATH)
}

let state: RuntimeConfig = loadFromDisk()

type Listener = (
  next: Readonly<RuntimeConfig>,
  prev: Readonly<RuntimeConfig>,
) => void
const listeners = new Set<Listener>()

function commit(next: RuntimeConfig): void {
  const prev = state
  writeToDisk(next)
  state = next
  for (const listener of listeners) {
    try {
      listener(state, prev)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[config-store] listener threw:", err)
    }
  }
}

export interface ConfigStore {
  get<K extends keyof RuntimeConfig>(key: K): RuntimeConfig[K]
  getAll(): Readonly<RuntimeConfig>
  set<K extends keyof RuntimeConfig>(key: K, value: RuntimeConfig[K]): void
  patch(patch: Partial<RuntimeConfig>): void
  subscribe(fn: Listener): () => void
  readonly filePath: string
}

export const configStore: ConfigStore = {
  get(key) {
    return state[key]
  },
  getAll() {
    return { ...state }
  },
  set(key, value) {
    commit(RuntimeConfigSchema.parse({ ...state, [key]: value }))
  },
  patch(patch) {
    commit(RuntimeConfigSchema.parse({ ...state, ...patch }))
  },
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  get filePath() {
    return CONFIG_PATH
  },
}
