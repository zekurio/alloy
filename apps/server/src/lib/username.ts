import { eq } from "drizzle-orm"

import { user } from "@workspace/db/auth-schema"

import { db } from "../db"

/**
 * Username handles used in `/u/:username` URLs.
 *
 * Design goals:
 *   - URL-safe: lowercase ASCII letters, digits, `_`, `-`. No percent-encoding
 *     or case-collision footguns.
 *   - Short enough to be typeable (24 chars max).
 *   - Unique across all users — enforced by a unique index on `user.username`.
 *   - Deterministic from a user's existing identity (name → email prefix →
 *     literal "user") so freshly-created users immediately have a readable
 *     handle, with a numeric suffix bump on collision.
 *
 * The `create.before` auth hook calls `generateUniqueUsername()` for every
 * new user, so the column is always populated. The DB column is `notNull` +
 * unique; resolution in routes is strictly by username.
 */

const MAX_LEN = 24
const MIN_LEN = 1
const MAX_SUFFIX = 100

/**
 * Produce a URL-safe slug from arbitrary user input. Keep this pure — it's
 * called at user-creation time and we rely on it matching its own output
 * when fed its own output (idempotent).
 */
export function slugifyUsername(input: string): string {
  return (
    input
      // Strip combining diacritics by decomposing then discarding marks.
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      // Anything outside [a-z0-9_-] becomes a hyphen — collapse runs and
      // trim leading/trailing hyphens so we don't produce "-foo-" handles.
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_LEN)
  )
}

/**
 * Deterministic base slug from a user's display identity. Prefers the name
 * (most recognisable to the user), falls back to the email local-part, and
 * finally to the literal "user" when neither is usable — which keeps the
 * output non-empty even for sparsely-populated rows.
 */
export function baseSlugFromUser(hints: {
  name?: string | null
  email?: string | null
}): string {
  const fromName = hints.name ? slugifyUsername(hints.name) : ""
  if (fromName.length >= MIN_LEN) return fromName

  const localPart = hints.email?.split("@")[0] ?? ""
  const fromEmail = slugifyUsername(localPart)
  if (fromEmail.length >= MIN_LEN) return fromEmail

  return "user"
}

/**
 * Build a unique username for a user. Tries the base slug first, then
 * `base2`, `base3`, … up to `MAX_SUFFIX`. Past that we append a short random
 * suffix — uniqueness is still DB-enforced, so this is a convenience path that
 * prevents O(n) probing when a common name has already been taken hundreds of
 * times (think "john"). The unique index is the actual safety net.
 */
export async function generateUniqueUsername(hints: {
  name?: string | null
  email?: string | null
}): Promise<string> {
  const base = baseSlugFromUser(hints)

  // Account for the suffix eating into the 24-char budget so the final
  // string never exceeds MAX_LEN.
  const reserveFor = (n: number) => MAX_LEN - String(n).length
  const trimBase = (reserve: number) =>
    base.length > reserve ? base.slice(0, reserve) : base

  const candidates: string[] = [base]
  for (let i = 2; i <= MAX_SUFFIX; i++) {
    candidates.push(`${trimBase(reserveFor(i))}${i}`)
  }

  for (const candidate of candidates) {
    if (await isUsernameAvailable(candidate)) return candidate
  }

  // Hit the probe limit — fall through to random suffix. Six hex chars
  // gives ~16M possibilities per base, which is well past anything the
  // linear probe could reasonably cover.
  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 8)
    const candidate = `${trimBase(MAX_LEN - suffix.length - 1)}-${suffix}`
    if (await isUsernameAvailable(candidate)) return candidate
  }

  // Extraordinarily unlikely — caller sees a unique-constraint error if
  // the DB somehow still rejects the insert. That's the right failure mode.
  throw new Error("Could not allocate a unique username")
}

async function isUsernameAvailable(candidate: string): Promise<boolean> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.username, candidate))
    .limit(1)
  return rows.length === 0
}
