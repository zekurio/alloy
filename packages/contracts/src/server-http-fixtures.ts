/**
 * Frozen wire fixture for the desktop HTTP contract 1 cutover.
 *
 * Keep this literal append-only after release. It intentionally does not import
 * policy constants, so tests catch a source change that mutates the contract.
 */
export const SERVER_HTTP_CONTRACT_1_FIXTURE = {
  schema: "alloy.server-info",
  version: "1.1.2",
  product: "alloy",
  httpContracts: [1],
  capabilities: {
    auth: {
      desktopAuth: 1,
      sessionCookies: 1,
    },
    transport: {
      json: 1,
      credentialedFetch: 1,
    },
  },
} as const
