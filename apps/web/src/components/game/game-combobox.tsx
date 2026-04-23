import * as React from "react"
import { AlertCircleIcon, SearchIcon } from "lucide-react"

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@workspace/ui/components/combobox"
import { GameIcon } from "@workspace/ui/components/game-icon"
import { InputGroupAddon } from "@workspace/ui/components/input-group"
import { cn } from "@workspace/ui/lib/utils"

import type { GameRow, SteamGridDBSearchResult } from "@workspace/api"
import {
  useGamesListQuery,
  useResolveGameMutation,
  useSearchGamesQuery,
  useSteamGridDBStatusQuery,
} from "@/lib/game-queries"
import { useDebouncedValue } from "@/lib/use-debounced-value"

type GameComboboxItem = SteamGridDBSearchResult & {
  iconUrl?: string | null
  logoUrl?: string | null
}

const PAGE_SIZE = 6

export interface GameComboboxProps {
  /** Currently picked game, or null when unset. */
  value: GameRow | null
  onChange: (next: GameRow | null) => void
  /** Visually dim + block interaction. Used while the parent is saving. */
  disabled?: boolean
  id?: string
  /** Optional placeholder for the unpicked state. */
  placeholder?: string
  allowClear?: boolean
  invalid?: boolean
  required?: boolean
  side?: "top" | "bottom"
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
  id,
  placeholder = "Search SteamGridDB…",
  allowClear = true,
  invalid = false,
  required = false,
  side = "bottom",
  className,
}: GameComboboxProps) {
  const statusQuery = useSteamGridDBStatusQuery()
  const configured = statusQuery.data?.steamgriddbConfigured ?? null

  // Input text is controlled so a picked value can show the game name
  // (via `itemToStringLabel` alone, the input would blank on open).
  const [inputValue, setInputValue] = React.useState(value?.name ?? "")
  const debouncedQuery = useDebouncedValue(inputValue, 200)

  const lastExternalNameRef = React.useRef<string | null>(value?.name ?? null)
  React.useEffect(() => {
    const nextName = value?.name ?? ""
    if (lastExternalNameRef.current !== nextName) {
      lastExternalNameRef.current = nextName
      setInputValue(nextName)
    }
  }, [value?.name])

  const gamesListQuery = useGamesListQuery()

  const searchQuery = useSearchGamesQuery(debouncedQuery, {
    // Only hit SGDB when the instance actually has a key configured.
    // Without this, an unconfigured instance would 503 on every type.
    enabled: configured === true,
  })

  const resolveMutation = useResolveGameMutation()

  const [pendingItem, setPendingItem] = React.useState<GameComboboxItem | null>(
    null
  )

  const [cleared, setCleared] = React.useState(false)

  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE)
  React.useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [debouncedQuery])

  React.useEffect(() => {
    if (value) setCleared(false)
  }, [value])

  const handlePick = React.useCallback(
    (picked: GameComboboxItem | null) => {
      if (picked === null) {
        if (!allowClear) {
          setCleared(true)
          setInputValue("")
          return
        }
        setPendingItem(null)
        setInputValue("")
        onChange(null)
        return
      }
      setCleared(false)
      setPendingItem(picked)
      setInputValue(picked.name)
      resolveMutation.mutate(
        { steamgriddbId: picked.id },
        {
          onSuccess: (row) => {
            setPendingItem(null)
            lastExternalNameRef.current = row.name
            onChange(row)
          },
          onError: () => {
            setPendingItem(null)
            // Roll the input back to whatever the parent still thinks is
            // selected — we couldn't finish the handshake.
            setInputValue(value?.name ?? "")
          },
        }
      )
    },
    [allowClear, onChange, resolveMutation, value?.name]
  )

  // Base UI's `filter` prop runs on every items change; we want zero
  // client-side filtering because the server already narrowed the list.
  const noopFilter = React.useCallback(() => true, [])

  const effectiveItems = React.useMemo<GameComboboxItem[]>(() => {
    const sgdbResults = searchQuery.data ?? []
    const localGames = gamesListQuery.data ?? []
    const q = debouncedQuery.trim().toLowerCase()

    // Filter already-known games by the current query — zero network cost.
    const localMatches: GameComboboxItem[] =
      q.length > 0
        ? localGames
            .filter((g) => g.name.toLowerCase().includes(q))
            .map((g) => ({
              id: g.steamgriddbId,
              name: g.name,
              iconUrl: g.iconUrl,
              logoUrl: g.logoUrl,
            }))
        : []

    // Append SGDB results that aren't already covered by a local match
    // so the list never contains duplicates.
    const sgdbOnly = sgdbResults.filter(
      (r) => !localMatches.some((l) => l.id === r.id)
    )

    const merged: GameComboboxItem[] = [...localMatches, ...sgdbOnly]

    // Ghost item: keeps the controlled selection visible when neither the
    // local list nor the current SGDB page contains the picked game.
    if (!value) return merged
    const pickedAsItem: GameComboboxItem = {
      id: value.steamgriddbId,
      name: value.name,
      iconUrl: value.iconUrl,
      logoUrl: value.logoUrl,
    }
    if (merged.some((r) => r.id === value.steamgriddbId)) return merged
    return [pickedAsItem, ...merged]
  }, [searchQuery.data, gamesListQuery.data, debouncedQuery, value])

  const controlledValue: GameComboboxItem | null = cleared
    ? null
    : value
      ? {
          id: value.steamgriddbId,
          name: value.name,
          iconUrl: value.iconUrl,
          logoUrl: value.logoUrl,
        }
      : (pendingItem ?? null)

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

  return (
    <div className={cn("relative", className)}>
      <Combobox<GameComboboxItem>
        items={effectiveItems}
        value={controlledValue}
        onValueChange={handlePick}
        inputValue={inputValue}
        onInputValueChange={setInputValue}
        itemToStringLabel={(item) => item.name}
        isItemEqualToValue={(a, b) => a?.id === b?.id}
        filter={noopFilter}
        disabled={isDisabled}
        autoHighlight
      >
        <ComboboxInput
          id={id}
          placeholder={placeholder}
          showTrigger={false}
          showClear={allowClear && value !== null}
          aria-label="Game"
          aria-busy={isSearching || resolving || undefined}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
        >
          {value ? (
            <InputGroupAddon align="inline-start">
              <GameIcon
                src={value.iconUrl ?? value.logoUrl}
                name={value.name}
              />
            </InputGroupAddon>
          ) : (
            <InputGroupAddon align="inline-start">
              <SearchIcon className="size-4 text-foreground-faint" />
            </InputGroupAddon>
          )}
        </ComboboxInput>
        <ComboboxContent side={side} className="min-w-[320px]">
          <ComboboxList>
            {effectiveItems.length === 0
              ? null
              : effectiveItems.slice(0, visibleCount).map((item) => {
                  return (
                    <ComboboxItem key={item.id} value={item} className="py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <GameIcon
                          src={item.iconUrl ?? item.logoUrl}
                          name={item.name}
                          size="lg"
                        />
                        <div className="min-w-0">
                          <span className="truncate text-sm text-foreground">
                            {item.name}
                          </span>
                        </div>
                      </div>
                    </ComboboxItem>
                  )
                })}
            {effectiveItems.length > visibleCount ? (
              <button
                type="button"
                onMouseDown={(e) => {
                  // Keep the input focused so the list doesn't close
                  // before our state update flushes.
                  e.preventDefault()
                }}
                onClick={() => {
                  setVisibleCount((n) =>
                    Math.min(n + PAGE_SIZE, effectiveItems.length)
                  )
                }}
                className={cn(
                  "flex w-full items-center justify-center rounded-md py-2 text-xs",
                  "text-foreground-muted hover:bg-accent hover:text-accent-foreground"
                )}
              >
                Show {Math.min(PAGE_SIZE, effectiveItems.length - visibleCount)}{" "}
                more
              </button>
            ) : null}
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
    </div>
  )
}
