import { eq } from "drizzle-orm"

import { game } from "@workspace/db/schema"

import { db } from "../db"

/**
 * Slug generation for the `game` table. Game slugs show up in
 * `/g/:slug` URLs, so they need to be URL-safe, stable across
 * upserts of the same SGDB id, and human-recognisable.
 *
 * The generator is one-shot and lives server-side: the upsert path
 * calls `generateUniqueGameSlug(name)` exactly once when a new SGDB
 * id lands, then the result gets pinned into the row and never
 * re-derived. That keeps `/g/:old-slug` links from breaking when
 * SGDB later ships a rename — the DB row carries the canonical slug,
 * not the name.
 */

const MAX_LEN = 48
const MIN_LEN = 1
const MAX_SUFFIX = 200

/**
 * Produce a URL-safe slug from a raw game name. Strips diacritics,
 * lowercases, collapses runs of non-alphanumeric characters to a
 * single hyphen, and caps the length. Idempotent: `slugifyGame(s)`
 * equals `slugifyGame(slugifyGame(s))` for any `s`.
 */
export function slugifyGame(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LEN)
}

/**
 * Produce a unique slug for a game name, probing the DB for
 * collisions. Tries the base slug first, then `-2`, `-3`, … up to
 * `MAX_SUFFIX`, then falls back to a random hex suffix — the unique
 * index on `game.slug` is the final safety net.
 *
 * Called only at upsert time (when a new SGDB id first shows up). If
 * two uploaders resolve the same never-before-seen game in parallel,
 * one of them will lose the INSERT race and retry with a fresh
 * suffix; both end up pointing at the same row because the probe
 * below runs inside the retry loop.
 */
export async function generateUniqueGameSlug(name: string): Promise<string> {
  const base = slugifyGame(name)
  // Fall back to "game" if slugifying stripped the whole string
  // (e.g. a CJK-only title with no ASCII characters).
  const seed = base.length >= MIN_LEN ? base : "game"

  const reserveFor = (n: number) => MAX_LEN - String(n).length - 1
  const trimSeed = (reserve: number) =>
    seed.length > reserve ? seed.slice(0, reserve) : seed

  const candidates: string[] = [seed]
  for (let i = 2; i <= MAX_SUFFIX; i++) {
    candidates.push(`${trimSeed(reserveFor(i))}-${i}`)
  }

  for (const candidate of candidates) {
    if (await isSlugAvailable(candidate)) return candidate
  }

  // Past the linear probe — random suffix. Extremely unlikely in
  // practice; the DB's unique constraint catches anything that
  // slips through a race.
  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 8)
    const candidate = `${trimSeed(MAX_LEN - suffix.length - 1)}-${suffix}`
    if (await isSlugAvailable(candidate)) return candidate
  }

  throw new Error("Could not allocate a unique game slug")
}

async function isSlugAvailable(candidate: string): Promise<boolean> {
  const rows = await db
    .select({ id: game.id })
    .from(game)
    .where(eq(game.slug, candidate))
    .limit(1)
  return rows.length === 0
}
