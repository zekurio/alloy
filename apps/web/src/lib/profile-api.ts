import { api } from "./api"

/**
 * Response shape for the manual OAuth image sync endpoint. Mirrors
 * `apps/server/src/routes/profile.ts`.
 */
export interface SyncOAuthImageResponse {
  status: string
  image: string | null
  message: string
}

/**
 * Ask the server to pull the current avatar from the configured OAuth
 * provider and write it onto `user.image`. Always overwrites — it's a
 * user-initiated action.
 *
 * Throws on non-2xx so callers can surface `message` in a toast. The
 * backend always includes a human-readable message for every status.
 */
export async function syncOAuthImage(): Promise<SyncOAuthImageResponse> {
  const res = await api.api.profile["sync-oauth-image"].$post()
  const body = (await res.json().catch(() => null)) as
    | SyncOAuthImageResponse
    | null
  if (!res.ok) {
    throw new Error(body?.message ?? `${res.status} ${res.statusText}`)
  }
  if (!body) {
    throw new Error("Unexpected empty response from sync endpoint.")
  }
  return body
}
