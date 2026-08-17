export type HousekeepingPathKind = "asset" | "audio" | "export" | "import"

const paths = new Map<HousekeepingPathKind, Map<string, number>>()

export function markHousekeepingPathActive(
  kind: HousekeepingPathKind,
  path: string,
): void {
  const active = paths.get(kind) ?? new Map<string, number>()
  active.set(path, (active.get(path) ?? 0) + 1)
  paths.set(kind, active)
}

export function markHousekeepingPathInactive(
  kind: HousekeepingPathKind,
  path: string,
): void {
  const active = paths.get(kind)
  const consumers = active?.get(path)
  if (!active || !consumers) return
  if (consumers > 1) {
    active.set(path, consumers - 1)
    return
  }
  active.delete(path)
  if (active.size === 0) paths.delete(kind)
}

export function activeHousekeepingPaths(
  kind: HousekeepingPathKind,
): ReadonlySet<string> {
  return new Set(paths.get(kind)?.keys())
}
