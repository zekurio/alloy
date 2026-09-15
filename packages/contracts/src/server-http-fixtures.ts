import fixture from "../fixtures/server-http-v1.json"
import { parseServerInfo } from "./server-http"

/**
 * Representative server-info response for desktop HTTP contract 1.
 *
 * Keep it independent of policy constants so tests check the wire format.
 * Update it when a coordinated desktop and server change requires it.
 */
export const SERVER_HTTP_CONTRACT_1_FIXTURE = parseServerInfo(fixture)
