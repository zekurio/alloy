import type { GameRow, SteamGridDBSearchResult } from "@alloy/api"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@alloy/ui/components/combobox"
import { GameIcon } from "@alloy/ui/components/game-icon"
import { InputGroupAddon } from "@alloy/ui/components/input-group"
import { cn } from "@alloy/ui/lib/utils"
import { AlertCircleIcon, SearchIcon } from "lucide-react"
import * as React from "react"

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
  clipCount?: number
}

const PAGE_SIZE = 6

interface GameComboboxProps {
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
  onConfiguredChange?: (configured: boolean | null) => void
  required?: boolean
  side?: "top" | "bottom"
  focusOnMount?: boolean
  /**
   * Extra classes on the wrapping element so callers can size the input
   * to match their form layout without overriding the combobox internals.
   */
  className?: string
  inputClassName?: string
}

export function GameCombobox({
  value,
  onChange,
  disabled = false,
  id,
  placeholder = "Search SteamGridDB…",
  allowClear = true,
  invalid = false,
  onConfiguredChange,
  required = false,
  side = "bottom",
  focusOnMount = false,
  className,
  inputClassName,
}: GameComboboxProps) {
  const statusQuery = useSteamGridDBStatusQuery()
  const configured = statusQuery.data?.steamgriddbConfigured ?? null

  React.useEffect(() => {
    onConfiguredChange?.(configured)
  }, [configured, onConfiguredChange])

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
    null,
  )

  const [cleared, setCleared] = React.useState(false)

  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE)
  React.useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [debouncedQuery])

  const anchorRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!focusOnMount) return
    anchorRef.current?.querySelector("input")?.focus()
  }, [focusOnMount])

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
        },
      )
    },
    [allowClear, onChange, resolveMutation, value?.name],
  )

  // Base UI's `filter` prop runs on every items change; we want zero
  // client-side filtering because the server already narrowed the list.
  const noopFilter = React.useCallback(() => true, [])

  const effectiveItems = React.useMemo<GameComboboxItem[]>(() => {
    const q = normalizeGameSearchText(debouncedQuery)
    const inputQuery = normalizeGameSearchText(inputValue)
    const sgdbResults = inputQuery === q ? (searchQuery.data ?? []) : []
    const localGames = gamesListQuery.data ?? []
    const currentMatch: GameComboboxItem[] =
      q.length > 0 &&
      value !== null &&
      normalizeGameSearchText(value.name).includes(q)
        ? [
            {
              id: value.steamgriddbId,
              name: value.name,
              iconUrl: value.iconUrl,
              logoUrl: value.logoUrl,
            },
          ]
        : []

    // Filter already-known games by the current query — zero network cost.
    const localMatches: GameComboboxItem[] =
      q.length > 0
        ? localGames
            .filter((g) => normalizeGameSearchText(g.name).includes(q))
            .map((g) => ({
              id: g.steamgriddbId,
              name: g.name,
              iconUrl: g.iconUrl,
              logoUrl: g.logoUrl,
              clipCount: g.clipCount,
            }))
        : []

    // Append SGDB results that aren't already covered by a local match so the
    // list never contains duplicates, then rank the combined set locally. The
    // server ranks remote rows, but local rows join here and need the same
    // treatment.
    const knownMatches = [...currentMatch, ...localMatches].filter(
      (item, index, items) =>
        items.findIndex((candidate) => candidate.id === item.id) === index,
    )
    const sgdbOnly = sgdbResults.filter(
      (r) => !knownMatches.some((l) => l.id === r.id),
    )

    return rankGameComboboxItems([...knownMatches, ...sgdbOnly], q)
  }, [searchQuery.data, gamesListQuery.data, debouncedQuery, inputValue, value])

  // Base UI tracks the controlled `value` by identity (useValueChanged), so
  // this object must stay referentially stable across renders — recreating it
  // inline re-fires Base UI's value-changed layout effect on every render and
  // loops until React aborts with "Maximum update depth exceeded".
  const committedValue = React.useMemo<GameComboboxItem | null>(
    () =>
      value
        ? {
            id: value.steamgriddbId,
            name: value.name,
            iconUrl: value.iconUrl,
            logoUrl: value.logoUrl,
          }
        : null,
    [value],
  )

  const selectedName = pendingItem?.name ?? committedValue?.name ?? ""
  const editingSelectedName =
    selectedName.length > 0 &&
    inputValue.trim().toLowerCase() !== selectedName.trim().toLowerCase()
  const controlledValue: GameComboboxItem | null =
    cleared || editingSelectedName ? null : (pendingItem ?? committedValue)

  if (configured === false) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-dashed border-border",
          "bg-surface-sunken px-3 py-2 text-xs text-foreground-faint",
          className,
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

  const hasError = searchQuery.isError
  const resolving = resolveMutation.isPending
  const isDisabled = disabled || resolving || configured === null

  return (
    <div ref={anchorRef} className={cn("relative", className)}>
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
          className={inputClassName}
          placeholder={placeholder}
          showTrigger={false}
          showClear={allowClear && controlledValue !== null}
          aria-label="Game"
          aria-busy={searchQuery.isFetching || resolving || undefined}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
        >
          {controlledValue ? (
            <InputGroupAddon align="inline-start">
              <GameIcon
                src={controlledValue.iconUrl ?? controlledValue.logoUrl}
                name={controlledValue.name}
              />
            </InputGroupAddon>
          ) : (
            <InputGroupAddon align="inline-start">
              <SearchIcon className="text-foreground-faint size-4" />
            </InputGroupAddon>
          )}
        </ComboboxInput>
        <ComboboxContent
          side={side}
          anchor={anchorRef}
          className="min-w-[360px]"
        >
          <ComboboxList>
            {effectiveItems.length === 0
              ? null
              : effectiveItems.slice(0, visibleCount).map((item) => {
                  return (
                    <ComboboxItem
                      key={item.id}
                      value={item}
                      className="h-8 items-center gap-2 py-0 pr-9 pl-2.5"
                    >
                      <GameIcon
                        src={item.iconUrl ?? item.logoUrl}
                        name={item.name}
                        className="size-4 rounded-sm [&_img]:object-contain"
                      />
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="text-foreground min-w-0 truncate text-sm leading-4 font-semibold">
                          {item.name}
                        </span>
                        <GameSearchResultYear item={item} />
                      </span>
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
                    Math.min(n + PAGE_SIZE, effectiveItems.length),
                  )
                }}
                className={cn(
                  "flex w-full items-center justify-center rounded-md py-2 text-xs",
                  "text-foreground-muted hover:bg-accent hover:text-accent-foreground",
                )}
              >
                Show {Math.min(PAGE_SIZE, effectiveItems.length - visibleCount)}{" "}
                more
              </button>
            ) : null}
            <ComboboxEmpty>
              {hasError
                ? "Couldn’t reach SteamGridDB"
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

function GameSearchResultYear({ item }: { item: GameComboboxItem }) {
  const releaseYear = releaseYearFromTimestamp(item.release_date)
  if (!releaseYear) return null

  return (
    <span className="text-foreground-faint min-w-0 truncate text-xs">
      - {releaseYear}
    </span>
  )
}

function normalizeGameSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[™®©]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
}

function rankGameComboboxItems(
  items: GameComboboxItem[],
  normalizedQuery: string,
): GameComboboxItem[] {
  if (!normalizedQuery) return items

  return items
    .map((item, index) => {
      const name = normalizeGameSearchText(item.name)
      const types = item.types?.map((type) => type.toLowerCase()) ?? []
      let score = 0

      if (name === normalizedQuery) score += 1000
      else if (name.startsWith(normalizedQuery)) score += 600
      else if (name.includes(normalizedQuery)) score += 250

      if (item.clipCount !== undefined) score += 140
      if (item.verified) score += 80
      if (types.includes("game")) score += 40
      if (types.some((type) => ["dlc", "demo", "mod"].includes(type))) {
        score -= 160
      }

      return { item, index, score }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item)
}

function releaseYearFromTimestamp(value: number | undefined): string | null {
  if (value === undefined) return null
  const year = new Date(value * 1000).getUTCFullYear()
  return Number.isFinite(year) ? String(year) : null
}
