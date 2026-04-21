import { eq } from "drizzle-orm"

import { user } from "@workspace/db/auth-schema"

import { db } from "../db"

export const USERNAME_MAX_LEN = 24
export const USERNAME_MIN_LEN = 1
const MAX_LEN = USERNAME_MAX_LEN
const MIN_LEN = USERNAME_MIN_LEN
const MAX_SUFFIX = 100

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
