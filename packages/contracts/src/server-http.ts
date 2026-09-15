import type { ContractJsonInput } from "./json-value"
import { isFiniteNumberValue, isStringValue } from "./object"
import { t } from "./schema"

/** Stable discriminator for the public server-info document. */
export const SERVER_INFO_SCHEMA = "alloy.server-info" as const

/** Stable product marker for rejecting responses from another service. */
export const SERVER_INFO_PRODUCT = "alloy" as const

/**
 * The only desktop HTTP contract the web app and the desktop host know.
 *
 * Alloy currently has one operator and no external deployments. Contract 1
 * can change with a coordinated desktop and server update. Version breaking
 * changes once independently deployed clients need a support window.
 */
export const DESKTOP_HTTP_CONTRACT_1 = 1 as const
export const DESKTOP_HTTP_CONTRACT_IDS = Object.freeze([
  DESKTOP_HTTP_CONTRACT_1,
] as const)

/** Known capability version in the contract-1 declaration. */
export const DESKTOP_HTTP_CAPABILITY_VERSION = 1 as const

/**
 * Capability identifiers implemented by the current API. Their versions must
 * match the behavior implemented by both the desktop and server.
 */
export const DESKTOP_HTTP_CAPABILITIES = Object.freeze({
  auth: Object.freeze({
    desktopAuth: DESKTOP_HTTP_CAPABILITY_VERSION,
    sessionCookies: DESKTOP_HTTP_CAPABILITY_VERSION,
  }),
  transport: Object.freeze({
    json: DESKTOP_HTTP_CAPABILITY_VERSION,
    credentialedFetch: DESKTOP_HTTP_CAPABILITY_VERSION,
  }),
} as const)

const PositiveSafeIntegerSchema = t
  .unknown()
  .refine(
    (value) =>
      isFiniteNumberValue(value) && Number.isSafeInteger(value) && value > 0,
    "must be a positive safe integer",
  )
  .transform((value) => {
    // SAFETY: The preceding refinement accepts only finite number primitives.
    return value as number
  })

const KnownCapabilityVersionSchema = t
  .unknown()
  .refine(
    (value) =>
      isFiniteNumberValue(value) &&
      Number.isSafeInteger(value) &&
      value === DESKTOP_HTTP_CAPABILITY_VERSION,
    `must be capability version ${DESKTOP_HTTP_CAPABILITY_VERSION}`,
  )
  .transform((value) => {
    // SAFETY: The preceding refinement accepts only finite number primitives.
    return value as number
  })

const InformationalVersionSchema = t
  .unknown()
  .refine(
    (value) => isStringValue(value) && value.trim().length > 0,
    "must be a non-empty string",
  )
  .transform((value) => {
    // SAFETY: The preceding refinement accepts only string primitives.
    return (value as string).trim()
  })

const AuthCapabilitiesSchema = t.looseObject({
  desktopAuth: KnownCapabilityVersionSchema,
  sessionCookies: KnownCapabilityVersionSchema,
})

const TransportCapabilitiesSchema = t.looseObject({
  json: KnownCapabilityVersionSchema,
  credentialedFetch: KnownCapabilityVersionSchema,
})

const DesktopHttpCapabilitiesSchema = t.looseObject({
  screenshots: t.enum([1]).optional(),
  auth: AuthCapabilitiesSchema,
  transport: TransportCapabilitiesSchema,
})

/**
 * Runtime schema for the `/api/server-info` document.
 *
 * The loose objects are intentional. A future server can append document or
 * capability fields without making a client reject a response. Known
 * capability fields stay exact, so a changed version is not treated as an
 * upgrade of the old contract.
 */
export const ServerInfoSchema = t.looseObject({
  schema: t.enum([SERVER_INFO_SCHEMA]),
  product: t.enum([SERVER_INFO_PRODUCT]),
  /** Informational application SemVer. Compatibility never uses this value. */
  version: InformationalVersionSchema,
  httpContracts: t.array(PositiveSafeIntegerSchema),
  /** Tauri shell contracts understood by the server-hosted web app. */
  desktopTauriBridgeContracts: t.array(PositiveSafeIntegerSchema),
  capabilities: DesktopHttpCapabilitiesSchema,
})

export type ServerInfo = t.infer<typeof ServerInfoSchema>

/** Parse a server-info response at an untrusted HTTP boundary. */
export function parseServerInfo(value: ContractJsonInput): ServerInfo {
  return ServerInfoSchema.parse(value)
}
