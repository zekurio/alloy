const MAX_LEN = 48
const MIN_LEN = 1

function trimSlugDashes(input: string): string {
  return input.replace(/^-+|-+$/g, "")
}

function slugifyGame(input: string): string {
  return trimSlugDashes(
    input
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, MAX_LEN),
  )
}

export function gameSlug(name: string): string {
  const base = slugifyGame(name)
  // Fall back to "game" if slugifying stripped the whole string
  // (e.g. a CJK-only title with no ASCII characters).
  return base.length >= MIN_LEN ? base : "game"
}
