import { api } from "./api"

export interface PublicClip {
  id: string
  title: string
  game: string | null
}

/**
 * Fetch the most recent public clips for decorative use on the login page.
 *
 * Soft-failing by design: the call is purely cosmetic (it backs the login-page
 * carousel), so a network hiccup or cold server should never block sign-in.
 * Callers get `[]` and the UI falls back to a static tile set.
 */
export async function fetchPublicClips(): Promise<PublicClip[]> {
  try {
    const res = await api.api.clips.$get()
    if (!res.ok) return []
    const rows = (await res.json()) as Array<{
      id: string
      title: string
      game: string | null
    }>
    return rows.map((r) => ({ id: r.id, title: r.title, game: r.game }))
  } catch {
    return []
  }
}
