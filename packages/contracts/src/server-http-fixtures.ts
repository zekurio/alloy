/**
 * Representative server-info response for desktop HTTP contract 1.
 *
 * Keep it independent of policy constants so tests check the wire format.
 * Update it when a coordinated desktop and server change requires it.
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
