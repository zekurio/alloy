import * as React from "react"
import { AlertCircleIcon, XIcon } from "lucide-react"

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@workspace/ui/components/combobox"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import type { GameRow, SteamGridDBSearchResult } from "../lib/games-api"
import {
  useGamesListQuery,
  useResolveGameMutation,
  useSearchGamesQuery,
  useSteamGridDBStatusQuery,
} from "../lib/game-queries"
import { useDebouncedValue } from "../lib/use-debounced-value"

/**
 * Async game picker backed by SteamGridDB's autocomplete. Internal flow:
 *
 *   type → debounce 200ms → local filter of known games (instant)
 *                         + `useSearchGamesQuery` → SGDB results appended
 *   pick → `resolveGame(steamgriddbId)` upserts our `game` row → parent
 *     callback fires with the full `GameRow`
 *
 * Local games from the `/games` list cache are filtered client-side first
 * so already-used titles appear immediately without a network round trip.
 * SGDB results that aren't already in the local list are appended once they
 * settle, covering games not yet in the library.
 *
 * The callers only need to know about `GameRow` — the SGDB handshake
 * stays inside. When SGDB isn't configured on the instance the picker
 * renders a read-only disabled placeholder so uploaders aren't nagged
 * by a non-functional input.
 *
 * Debounce sits in front of the query hook (not inside it) so react-query's
 * cache keys line up with settled queries — a fresh keystroke doesn't
 * mint a cache entry that will never be hit again.
 */
export interface GameComboboxProps {
  /** Currently picked game, or null when unset. */
  value: GameRow | null
  /**
   * Fires on pick and on clear. `null` means the caller should remove any
   * existing game mapping; a `GameRow` is the freshly resolved row from
   * `/api/games/resolve`. Not fired on intermediate keystrokes.
   */
  onChange: (next: GameRow | null) => void
  /** Visually dim + block interaction. Used while the parent is saving. */
  disabled?: boolean
  /** Optional placeholder for the unpicked state. */
  placeholder?: string
  /**
   * Extra classes on the wrapping element so callers can size the input
   * to match their form layout without overriding the combobox internals.
   */
  className?: string
}

export function GameCombobox({
  value,
  onChange,
  disabled = false,
  placeholder = "Search SteamGridDB…",
  className,
}: GameComboboxProps) {
  const statusQuery = useSteamGridDBStatusQuery()
  const configured = statusQuery.data?.steamgriddbConfigured ?? null

  // Input text is controlled so a picked value can show the game name
  // (via `itemToStringLabel` alone, the input would blank on open).
  const [inputValue, setInputValue] = React.useState(value?.name ?? "")
  const debouncedQuery = useDebouncedValue(inputValue, 200)

  // Mirror the parent's picked value into the input when it changes from
  // the outside — e.g. after a save round-trip or a form reset. Skip when
  // the user is actively typing (their draft would otherwise get clobbered).
  const lastExternalNameRef = React.useRef<string | null>(value?.name ?? null)
  React.useEffect(() => {
    const nextName = value?.name ?? ""
    if (lastExternalNameRef.current !== nextName) {
      lastExternalNameRef.current = nextName
      setInputValue(nextName)
    }
  }, [value?.name])

  // Already-known games — populated from the /games page cache or fetched
  // on first combobox mount. Used for instant local filtering before SGDB
  // responds, so common picks feel snappy even on a slow connection.
  const gamesListQuery = useGamesListQuery()

  const searchQuery = useSearchGamesQuery(debouncedQuery, {
    // Only hit SGDB when the instance actually has a key configured.
    // Without this, an unconfigured instance would 503 on every type.
    enabled: configured === true,
  })

  const resolveMutation = useResolveGameMutation()

  // We track the SGDB pick separately from the parent's `GameRow` so
  // react-query's `isPending` on `resolveMutation` can gate the picker
  // without the UI dropping back to "no selection" mid-resolve.
  const handlePick = React.useCallback(
    (picked: SteamGridDBSearchResult | null) => {
      if (picked === null) {
        setInputValue("")
        onChange(null)
        return
      }
      // Eagerly reflect the pick in the input — the resolve round trip
      // takes a beat, and leaving the field blank until it returns
      // reads as "nothing happened".
      setInputValue(picked.name)
      resolveMutation.mutate(
        { steamgriddbId: picked.id },
        {
          onSuccess: (row) => {
            // Align our mirror ref with the now-committed value so the
            // external-value effect above doesn't immediately overwrite
            // the same text with an identical value (wasted render).
            lastExternalNameRef.current = row.name
            onChange(row)
          },
          onError: () => {
            // Roll the input back to whatever the parent still thinks is
            // selected — we couldn't finish the handshake.
            setInputValue(value?.name ?? "")
          },
        }
      )
    },
    [onChange, resolveMutation, value?.name]
  )

  // Base UI's `filter` prop runs on every items change; we want zero
  // client-side filtering because the server already narrowed the list.
  const noopFilter = React.useCallback(() => true, [])

  if (configured === false) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-dashed border-border",
          "bg-surface-sunken px-3 py-2 text-xs text-foreground-faint",
          className
        )}
      >
        <AlertCircleIcon className="size-3.5 shrink-0" />
        <span>
          SteamGridDB isn&rsquo;t configured on this instance. Ask an admin to
          add a key in Integrations.
        </span>
      </div>
    )
  }

  const isSearching =
    configured === true &&
    debouncedQuery.trim().length > 0 &&
    searchQuery.isFetching
  const hasError = searchQuery.isError
  const resolving = resolveMutation.isPending
  const isDisabled = disabled || resolving || configured === null

  // Build the picker list: local matches first (instant), then any SGDB
  // results that aren't already represented (appended once they settle).
  // Ghost-item logic ensures base-ui's controlled `value` always has
  // something to match against even before a search has fired.
  const effectiveItems = React.useMemo<SteamGridDBSearchResult[]>(() => {
    const sgdbResults = searchQuery.data ?? []
    const localGames = gamesListQuery.data ?? []
    const q = debouncedQuery.trim().toLowerCase()

    // Filter already-known games by the current query — zero network cost.
    const localMatches: SteamGridDBSearchResult[] =
      q.length > 0
        ? localGames
            .filter((g) => g.name.toLowerCase().includes(q))
            .map((g) => ({ id: g.steamgriddbId, name: g.name }))
        : []

    // Append SGDB results that aren't already covered by a local match
    // so the list never contains duplicates.
    const sgdbOnly = sgdbResults.filter(
      (r) => !localMatches.some((l) => l.id === r.id)
    )

    const merged = [...localMatches, ...sgdbOnly]

    // Ghost item: keeps the controlled selection visible when neither the
    // local list nor the current SGDB page contains the picked game.
    if (!value) return merged
    const pickedAsItem: SteamGridDBSearchResult = {
      id: value.steamgriddbId,
      name: value.name,
    }
    if (merged.some((r) => r.id === value.steamgriddbId)) return merged
    return [pickedAsItem, ...merged]
  }, [searchQuery.data, gamesListQuery.data, debouncedQuery, value])

  const controlledValue: SteamGridDBSearchResult | null = value
    ? { id: value.steamgriddbId, name: value.name }
    : null

  return (
    <div className={cn("relative", className)}>
      <Combobox<SteamGridDBSearchResult>
        items={effectiveItems}
        value={controlledValue}
        onValueChange={handlePick}
        inputValue={inputValue}
        onInputValueChange={setInputValue}
        itemToStringLabel={(item) => item.name}
        isItemEqualToValue={(a, b) => a?.id === b?.id}
        filter={noopFilter}
        disabled={isDisabled}
        openOnInputClick={false}
        autoHighlight
      >
        <ComboboxInput
          placeholder={placeholder}
          showTrigger={false}
          showClear={value !== null}
          aria-label="Game"
          aria-busy={isSearching || resolving || undefined}
        />
        <ComboboxContent className="min-w-[320px]">
          <ComboboxList>
            {effectiveItems.length === 0
              ? null
              : effectiveItems.map((item) => (
                  <ComboboxItem key={item.id} value={item} className="py-2">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm text-foreground">
                        {item.name}
                      </span>
                      {item.release_date ? (
                        <span className="text-2xs text-foreground-faint">
                          {new Date(item.release_date * 1000).getFullYear()}
                        </span>
                      ) : null}
                    </div>
                  </ComboboxItem>
                ))}
            <ComboboxEmpty>
              {hasError
                ? "Couldn’t reach SteamGridDB"
                : isSearching
                  ? "Searching…"
                  : debouncedQuery.trim().length === 0
                    ? "Start typing to search"
                    : "No matches"}
            </ComboboxEmpty>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>

      {value !== null && !disabled ? (
        <ClearPickedButton
          onClick={() => handlePick(null)}
          disabled={resolving}
        />
      ) : null}
    </div>
  )
}

/**
 * Compact "×" button stacked on the right edge of the combobox input.
 * base-ui's own `ComboboxClear` drops the selection but leaves the input
 * text — we want both cleared, so we wire a manual one that delegates
 * to the same pick handler used for list selections.
 */
function ClearPickedButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label="Clear game"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "absolute top-1/2 right-1 -translate-y-1/2",
        "text-foreground-faint hover:text-foreground"
      )}
    >
      <XIcon className="size-3.5" />
    </Button>
  )
}
