import type { ClipRow, GameNameLookupResult, GameRow } from "@alloy/api"
import { toast } from "@alloy/ui/lib/toast"
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import * as React from "react"

import {
  type AlloyDesktop,
  desktopCachedAssetUrl,
  onLibraryCapturesChanged,
  type RecordingLibraryGroup,
  type RecordingLibraryItem,
  type RecordingLibrarySnapshot,
} from "@/lib/desktop"
import { useGameNameLookupQuery } from "@/lib/game-queries"

export type LibraryItemView = RecordingLibraryItem & {
  displayGame: GameRow | null
  displayGameIconUrl: string | null
  displayGameName: string
  gameSlug: string | null
}

export interface LibrarySnapshotState {
  snapshot: RecordingLibrarySnapshot | null
  error: string | null
  refreshing: boolean
  refresh: () => Promise<void>
}

const librarySnapshotKey = ["desktop", "library-snapshot"] as const

function invalidateLibrarySnapshot(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: librarySnapshotKey })
}

function librarySnapshotErrorMessage(cause: unknown): string | null {
  if (!cause) return null
  return cause instanceof Error ? cause.message : "Could not scan local clips."
}

/**
 * Loads the desktop capture library and keeps it fresh: refreshes when the
 * recorder reports a new capture or a settings change. Shared by the library
 * grid and the capture editor route so both render from the same scan shape.
 * Outside Alloy Desktop (`desktop` null) it stays empty without erroring.
 */
export function useLibrarySnapshot(
  desktop: AlloyDesktop | null,
): LibrarySnapshotState {
  const queryClient = useQueryClient()
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: librarySnapshotKey,
    queryFn: async () => {
      if (!desktop) throw new Error("Desktop library is unavailable.")
      return desktop.recording.getLibrary()
    },
    enabled: desktop !== null,
  })
  const snapshot = desktop ? (data ?? null) : null
  const errorMessage = librarySnapshotErrorMessage(error)
  const blockingError = snapshot ? null : errorMessage
  const lastToastedErrorRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!errorMessage) {
      lastToastedErrorRef.current = null
      return
    }
    if (lastToastedErrorRef.current === errorMessage) return
    lastToastedErrorRef.current = errorMessage
    toast.error(errorMessage)
  }, [errorMessage])

  const refresh = React.useCallback(async () => {
    if (!desktop) return
    await refetch()
  }, [desktop, refetch])

  React.useEffect(() => {
    if (!desktop) return
    return desktop.recording.onEvent((event) => {
      if (event.type === "capture-ready" || event.type === "settings") {
        window.setTimeout(() => {
          invalidateLibrarySnapshot(queryClient)
        }, 250)
      }
    })
  }, [desktop, queryClient])

  React.useEffect(() => {
    if (!desktop) return
    return onLibraryCapturesChanged(() => {
      invalidateLibrarySnapshot(queryClient)
    })
  }, [desktop, queryClient])

  return {
    snapshot,
    error: desktop ? blockingError : null,
    refreshing: isFetching,
    refresh,
  }
}

/**
 * Resolves the snapshot's game labels against the server's indexed games. Only
 * fully confident matches (confidence === 1) are surfaced — an ambiguous name
 * renders as the raw label instead of a wrong game.
 */
export function useLibraryGameLookup(
  snapshot: RecordingLibrarySnapshot | null,
): Map<string, GameNameLookupResult> {
  const sourceNames = React.useMemo(() => {
    if (!snapshot) return []
    const names = new Set<string>()
    for (const group of snapshot.groups) {
      if (group.kind === "game") names.add(group.label)
    }
    for (const item of snapshot.items) {
      if (item.gameName) names.add(item.gameName)
    }
    return [...names]
  }, [snapshot])
  const gameLookup = useGameNameLookupQuery(sourceNames, {
    enabled: sourceNames.length > 0,
  })
  return React.useMemo(
    () => gameLookupByName(gameLookup.data?.results ?? []),
    [gameLookup.data],
  )
}

export function enrichLibraryItem(
  item: RecordingLibraryItem,
  gamesByName: Map<string, GameNameLookupResult>,
): LibraryItemView {
  const lookupName = item.gameName ?? item.groupLabel
  const match =
    item.source === "display" && !item.gameName
      ? null
      : gamesByName.get(gameNameKey(lookupName))
  const game = match?.confidence === 1 ? match.game : null
  const displayGameName =
    item.gameName ??
    game?.name ??
    (item.source === "display" ? "" : item.groupLabel)
  const steamgriddbIconUrl = desktopCachedAssetUrl(
    game?.iconUrl ?? game?.logoUrl ?? null,
  )
  return {
    ...item,
    displayGame: game,
    // When a local game label resolves cleanly, use the server's canonical
    // steamgriddb art so local and uploaded library rows stay visually consistent.
    // The capture-provided icon remains the fallback for unresolved games.
    displayGameIconUrl: steamgriddbIconUrl ?? item.gameIconUrl,
    displayGameName,
    gameSlug: game?.slug ?? null,
  }
}

/** Sentinel filter key for captures and server rows that carry no game. */
export const LIBRARY_NO_GAME_GROUP_KEY = "::no-game"

/** A source chip in the library filter bar, merging local and uploaded clips. */
export interface LibraryGroupView {
  key: string
  label: string
  kind: "game" | "no-game"
  iconUrl: string | null
  /** Local capture group keys this chip covers (for filtering snapshot items). */
  localKeys: string[]
  /** Normalised game name for matching server rows; null for no-game rows. */
  nameKey: string | null
  totalCount: number
}

/**
 * Builds the filter-bar source chips. Local capture groups and uploaded clips
 * are merged by game name so a server clip counts toward its actual game (e.g.
 * "Brotato") instead of a generic uploaded bucket. Local desktop captures and
 * server rows with no game share the no-game chip, so syncing does not move a
 * capture between different source categories.
 *
 * `collapsedCounts` holds, per local group key, how many captures collapsed
 * into their uploaded clip — those count toward the clip's game chip instead,
 * so they're subtracted here (a chip left at zero disappears).
 */
export function buildLibraryGroups(
  localGroups: RecordingLibraryGroup[],
  uploaded: ClipRow[],
  collapsedCounts?: Map<string, number>,
): LibraryGroupView[] {
  const map = new Map<string, LibraryGroupView>()

  for (const group of localGroups) {
    const totalCount = group.totalCount - (collapsedCounts?.get(group.key) ?? 0)
    if (totalCount <= 0) continue
    if (group.kind === "desktop") {
      addNoGameGroup(map, totalCount, group.key)
      continue
    }
    const nameKey = gameNameKey(group.label)
    const existing = map.get(nameKey)
    if (existing) {
      existing.localKeys.push(group.key)
      existing.totalCount += totalCount
      existing.iconUrl ??= group.iconUrl
    } else {
      map.set(nameKey, {
        key: nameKey,
        label: group.label,
        kind: "game",
        iconUrl: group.iconUrl,
        localKeys: [group.key],
        nameKey,
        totalCount,
      })
    }
  }

  for (const row of uploaded) {
    const gameName = row.gameRef?.name ?? row.game
    if (!gameName) {
      addNoGameGroup(map, 1)
      continue
    }
    const nameKey = gameNameKey(gameName)
    const existing = map.get(nameKey)
    const iconUrl = desktopCachedAssetUrl(
      row.gameRef?.iconUrl ?? row.gameRef?.logoUrl ?? null,
    )
    if (existing) {
      existing.totalCount += 1
      existing.iconUrl ??= iconUrl
    } else {
      map.set(nameKey, {
        key: nameKey,
        label: gameName,
        kind: "game",
        iconUrl,
        localKeys: [],
        nameKey,
        totalCount: 1,
      })
    }
  }

  return [...map.values()].sort((a, b) => {
    // The catch-all no-game chip sinks to the end; the rest rank by volume.
    if (a.kind === "no-game") return 1
    if (b.kind === "no-game") return -1
    return b.totalCount - a.totalCount
  })
}

function addNoGameGroup(
  map: Map<string, LibraryGroupView>,
  totalCount: number,
  localKey?: string,
): void {
  const existing = map.get(LIBRARY_NO_GAME_GROUP_KEY)
  if (existing) {
    existing.totalCount += totalCount
    if (localKey) existing.localKeys.push(localKey)
    return
  }

  map.set(LIBRARY_NO_GAME_GROUP_KEY, {
    key: LIBRARY_NO_GAME_GROUP_KEY,
    label: "No game",
    kind: "no-game",
    iconUrl: null,
    localKeys: localKey ? [localKey] : [],
    nameKey: null,
    totalCount,
  })
}

export function enrichGroupIcon(
  group: RecordingLibraryGroup,
  gamesByName: Map<string, GameNameLookupResult>,
): RecordingLibraryGroup {
  if (group.kind !== "game") return group
  const match = gamesByName.get(gameNameKey(group.label))
  const game = match?.confidence === 1 ? match.game : null
  const steamgriddbIconUrl = desktopCachedAssetUrl(
    game?.iconUrl ?? game?.logoUrl ?? null,
  )
  return {
    ...group,
    iconUrl: steamgriddbIconUrl ?? group.iconUrl,
  }
}

function gameLookupByName(
  results: GameNameLookupResult[],
): Map<string, GameNameLookupResult> {
  const map = new Map<string, GameNameLookupResult>()
  for (const result of results) {
    map.set(gameNameKey(result.name), result)
    if (result.game) map.set(gameNameKey(result.game.name), result)
  }
  return map
}

export function gameNameKey(name: string): string {
  return name.trim().toLowerCase()
}

export function libraryKindLabel(kind: RecordingLibraryItem["kind"]): string {
  switch (kind) {
    case "replay":
      return "Clip"
    case "long-recording":
      return "Session"
    case "screenshot":
      return "Screenshot"
    default:
      return "Capture"
  }
}

export function formatLibraryBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${
    units[exponent]
  }`
}

export function formatLibraryDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(value))
}
