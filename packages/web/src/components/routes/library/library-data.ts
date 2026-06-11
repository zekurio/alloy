import type { ClipRow, GameNameLookupResult, GameRow } from "alloy-api"
import { toast } from "alloy-ui/lib/toast"
import * as React from "react"

import {
  type AlloyDesktop,
  desktopCachedAssetUrl,
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

/**
 * Loads the desktop capture library and keeps it fresh: refreshes when the
 * recorder reports a new capture or a settings change. Shared by the library
 * grid and the capture editor route so both render from the same scan shape.
 * Outside Alloy Desktop (`desktop` null) it stays empty without erroring.
 */
export function useLibrarySnapshot(
  desktop: AlloyDesktop | null,
): LibrarySnapshotState {
  const [snapshot, setSnapshot] =
    React.useState<RecordingLibrarySnapshot | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)

  const refresh = React.useCallback(async () => {
    if (!desktop) return
    setRefreshing(true)
    setError(null)
    try {
      setSnapshot(await desktop.recording.getLibrary())
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Could not scan local clips."
      setError(message)
      toast.error(message)
    } finally {
      setRefreshing(false)
    }
  }, [desktop])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    if (!desktop) return
    return desktop.recording.onEvent((event) => {
      if (event.type === "capture-ready" || event.type === "settings") {
        window.setTimeout(() => {
          void refresh()
        }, 250)
      }
    })
  }, [desktop, refresh])

  return { snapshot, error, refreshing, refresh }
}

/**
 * Resolves the snapshot's game-source labels against the server's indexed
 * games. Only fully confident matches (confidence === 1) are surfaced — an
 * ambiguous name renders as the raw folder label instead of a wrong game.
 */
export function useLibraryGameLookup(
  snapshot: RecordingLibrarySnapshot | null,
): Map<string, GameNameLookupResult> {
  const sourceNames = React.useMemo(
    () =>
      snapshot?.groups
        .filter((group) => group.kind === "game")
        .map((group) => group.label) ?? [],
    [snapshot],
  )
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
  const match = gamesByName.get(gameNameKey(item.groupLabel))
  const game = match?.confidence === 1 ? match.game : null
  const displayGameName = item.gameName ?? game?.name ?? item.groupLabel
  return {
    ...item,
    displayGame: game,
    // Lookup-resolved icons go through the desktop asset cache; the
    // capture-provided icon URL is already cache-routed by the main process.
    displayGameIconUrl:
      item.gameIconUrl ??
      desktopCachedAssetUrl(game?.iconUrl ?? game?.logoUrl ?? null),
    displayGameName,
    gameSlug: game?.slug ?? null,
  }
}

/** Sentinel filter key for uploaded clips that carry no game. */
export const LIBRARY_CLOUD_GROUP_KEY = "::cloud"

/** A source chip in the library filter bar, merging local and uploaded clips. */
export interface LibraryGroupView {
  key: string
  label: string
  kind: "game" | "desktop" | "cloud"
  iconUrl: string | null
  /** Local capture group keys this chip covers (for filtering snapshot items). */
  localKeys: string[]
  /** Normalised game name for matching uploaded clips; null for desktop/cloud. */
  nameKey: string | null
  totalCount: number
}

/**
 * Builds the filter-bar source chips. Local capture groups and uploaded clips
 * are merged by game name so a server clip counts toward its actual game (e.g.
 * "Brotato") instead of a generic "Uploaded" bucket. Only uploaded clips with
 * no game fall back to the cloud chip.
 */
export function buildLibraryGroups(
  localGroups: RecordingLibraryGroup[],
  uploaded: ClipRow[],
): LibraryGroupView[] {
  const map = new Map<string, LibraryGroupView>()

  for (const group of localGroups) {
    if (group.kind === "desktop") {
      map.set(group.key, {
        key: group.key,
        label: group.label,
        kind: "desktop",
        iconUrl: null,
        localKeys: [group.key],
        nameKey: null,
        totalCount: group.totalCount,
      })
      continue
    }
    const nameKey = gameNameKey(group.label)
    const existing = map.get(nameKey)
    if (existing) {
      existing.localKeys.push(group.key)
      existing.totalCount += group.totalCount
      existing.iconUrl ??= group.iconUrl
    } else {
      map.set(nameKey, {
        key: nameKey,
        label: group.label,
        kind: "game",
        iconUrl: group.iconUrl,
        localKeys: [group.key],
        nameKey,
        totalCount: group.totalCount,
      })
    }
  }

  for (const row of uploaded) {
    const gameName = row.gameRef?.name ?? row.game
    if (!gameName) {
      const cloud = map.get(LIBRARY_CLOUD_GROUP_KEY)
      if (cloud) {
        cloud.totalCount += 1
      } else {
        map.set(LIBRARY_CLOUD_GROUP_KEY, {
          key: LIBRARY_CLOUD_GROUP_KEY,
          label: "Uploaded",
          kind: "cloud",
          iconUrl: null,
          localKeys: [],
          nameKey: null,
          totalCount: 1,
        })
      }
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
    // The catch-all uploaded chip sinks to the end; the rest rank by volume.
    if (a.kind === "cloud") return 1
    if (b.kind === "cloud") return -1
    return b.totalCount - a.totalCount
  })
}

export function enrichGroupIcon(
  group: RecordingLibraryGroup,
  gamesByName: Map<string, GameNameLookupResult>,
): RecordingLibraryGroup {
  if (group.kind !== "game" || group.iconUrl) return group
  const match = gamesByName.get(gameNameKey(group.label))
  const game = match?.confidence === 1 ? match.game : null
  return {
    ...group,
    iconUrl: desktopCachedAssetUrl(game?.iconUrl ?? game?.logoUrl ?? null),
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
