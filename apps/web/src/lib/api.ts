import { createApiClient } from "@workspace/api"

import { apiOrigin } from "./env"

// Typed Hono RPC client — call like `await api.api.clips.$get()`.
// Resolved per-call so it works with `window.location.origin` in the browser.
export const api = createApiClient(apiOrigin())
