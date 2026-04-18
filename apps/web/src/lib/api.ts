import { createApiClient } from "@workspace/api"

import { env } from "./env"

// Typed Hono RPC client — call like `await api.api.clips.$get()`.
// The API URL is validated at module load via `./env`.
export const api = createApiClient(env.VITE_API_URL)
