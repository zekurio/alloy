import { eq } from "drizzle-orm"

import { game } from "@workspace/db/schema"

import { db } from "../db"

const MAX_LEN = 48
const MIN_LEN = 1
const MAX_SUFFIX = 200

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
