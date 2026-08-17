export type HousekeepingPathKind = "asset" | "audio" | "export" | "import"

const paths = new Map<HousekeepingPathKind, Set<string>>()

export function markHousekeepingPathActive(
  kind: HousekeepingPathKind,
  path: string,
): void {
  const active = paths.get(kind) ?? new Set<string>()
  active.add(path)
  paths.set(kind, active)
}

export function markHousekeepingPathInactive(
  kind: HousekeepingPathKind,
  path: string,
): void {
  paths.get(kind)?.delete(path)
}

export function activeHousekeepingPaths(
  kind: HousekeepingPathKind,
): ReadonlySet<string> {
  return new Set(paths.get(kind))
}
