import type { GameRow } from "@alloy/api"
import { t, tp } from "@alloy/i18n"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@alloy/ui/components/combobox"
import { InputGroupAddon } from "@alloy/ui/components/input-group"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { SearchIcon } from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"

import { GameIcon } from "@/components/game/game-icon"
import { errorMessage } from "@/lib/error-message"
import {
  useLocalGameSearchQuery,
  useResolveGameMutation,
  useSearchGamesQuery,
} from "@/lib/game-queries"
import { useDebouncedValue } from "@/lib/use-debounced-value"

type GameComboboxItem = {
  /** List key + equality id: a game uuid, or `sgdb:<id>` for remote-only rows. */
  id: string
  name: string
  releaseDate?: GameRow["releaseDate"]
  release_date?: number | null
  types?: string[]
  verified?: boolean
  iconUrl?: string | null
  logoUrl?: string | null
  /** Set when the game already exists locally — picking is instant. */
  game?: GameRow
  /** SteamGridDB id for remote-only results that still need resolving. */
  steamgriddbId?: number
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
  placeholder = t("Search SteamGridDB…"),
  allowClear = true,
  invalid = false,
  required = false,
  side = "bottom",
  focusOnMount = false,
  className,
  inputClassName,
}: GameComboboxProps) {
  // Input text is controlled so a picked value can show the game name
  // (via `itemToStringLabel` alone, the input would blank on open).
  const [inputValue, setInputValue] = useState(value?.name ?? "")
  const debouncedQuery = useDebouncedValue(inputValue, 200)

  // A new name from the parent replaces the input text, unless it is the echo
  // of a game picked here: `shown` is the name the input already holds.
  const externalName = value?.name ?? ""
  const [names, setNames] = useState({
    prop: externalName,
    shown: externalName,
  })
  if (names.prop !== externalName) {
    setNames({ prop: externalName, shown: externalName })
    if (names.shown !== externalName) setInputValue(externalName)
  }
  const showPicked = (name: string) =>
    setNames((current) => ({ ...current, shown: name }))

  const localSearchQuery = useLocalGameSearchQuery(debouncedQuery)

  const searchQuery = useSearchGamesQuery(debouncedQuery)

  const resolveMutation = useResolveGameMutation()

  // What the input shows instead of `value`: a remote pick still resolving, or
  // an emptied input when clearing isn't allowed. The clear holds until the
  // parent passes a different value.
  const [override, setOverride] = useState<
    | { kind: "pending"; item: GameComboboxItem }
    | { kind: "cleared"; from: GameRow | null }
    | null
  >(null)
  const pendingItem = override?.kind === "pending" ? override.item : null
  const cleared = override?.kind === "cleared" && override.from === value

  // Paging restarts with every new query.
  const [page, setPage] = useState({ query: debouncedQuery, count: PAGE_SIZE })
  if (page.query !== debouncedQuery) {
    setPage({ query: debouncedQuery, count: PAGE_SIZE })
  }
  const visibleCount = page.query === debouncedQuery ? page.count : PAGE_SIZE

  const anchorRef = useRef<HTMLDivElement | null>(null)
  const attachAnchor = useCallback(
    (anchor: HTMLDivElement | null) => {
      anchorRef.current = anchor
      if (focusOnMount) anchor?.querySelector("input")?.focus()
    },
    [focusOnMount],
  )

  const handlePick = useCallback(
    (picked: GameComboboxItem | null) => {
      if (picked === null) {
        if (!allowClear) {
          setOverride({ kind: "cleared", from: value })
          setInputValue("")
          return
        }
        setOverride(null)
        setInputValue("")
        onChange(null)
        return
      }
      setInputValue(picked.name)
      // Local/custom games are already resolved — attach them directly. Only
      // remote-only SteamGridDB results need a resolve round-trip to mint a row.
      if (picked.game) {
        setOverride(null)
        showPicked(picked.game.name)
        onChange(picked.game)
        return
      }
      if (picked.steamgriddbId == null) {
        setOverride(null)
        return
      }
      setOverride({ kind: "pending", item: picked })
      resolveMutation.mutate(
        { steamgriddbId: picked.steamgriddbId },
        {
          onSuccess: (row) => {
            setOverride(null)
            showPicked(row.name)
            onChange(row)
          },
          onError: (cause) => {
            setOverride(null)
            // Roll the input back to whatever the parent still thinks is
            // selected — we couldn't finish the handshake.
            setInputValue(value?.name ?? "")
            toast.error(errorMessage(cause, t("Couldn't add game")))
          },
        },
      )
    },
    [allowClear, onChange, resolveMutation, value],
  )

  // Base UI's `filter` prop runs on every items change; we want zero
  // client-side filtering because the server already narrowed the list.
  const noopFilter = useCallback(() => true, [])

  const effectiveItems = useMemo<GameComboboxItem[]>(() => {
    const q = normalizeGameSearchText(debouncedQuery)
    const inputQuery = normalizeGameSearchText(inputValue)
    const steamgriddbResults = inputQuery === q ? (searchQuery.data ?? []) : []
    const localGames = localSearchQuery.data ?? []
    const currentMatch: GameComboboxItem[] =
      q.length > 0 &&
      value !== null &&
      normalizeGameSearchText(value.name).includes(q)
        ? [
            {
              id: value.id,
              name: value.name,
              releaseDate: value.releaseDate,
              iconUrl: value.iconUrl,
              logoUrl: value.logoUrl,
              game: value,
            },
          ]
        : []

    // Local catalogue rows (custom + SteamGridDB) are already resolved.
    const localMatches: GameComboboxItem[] = localGames.map((g) => ({
      id: g.id,
      name: g.name,
      releaseDate: g.releaseDate,
      iconUrl: g.iconUrl,
      logoUrl: g.logoUrl,
      game: g,
    }))

    const knownMatches = [...currentMatch, ...localMatches].filter(
      (item, index, items) =>
        items.findIndex((candidate) => candidate.id === item.id) === index,
    )
    // Drop remote results already covered by a local row (same SteamGridDB id),
    // then rank the combined set locally so local rows interleave correctly.
    const knownSteamGridDBIds = new Set(
      knownMatches
        .map((m) => m.game?.steamgriddbId)
        .filter((id): id is number => id != null),
    )
    const steamgriddbOnly: GameComboboxItem[] = steamgriddbResults
      .filter((r) => !knownSteamGridDBIds.has(r.id))
      .map((r) => ({
        id: `sgdb:${r.id}`,
        name: r.name,
        release_date: r.release_date,
        types: r.types,
        verified: r.verified,
        iconUrl: r.iconUrl,
        logoUrl: r.logoUrl,
        steamgriddbId: r.id,
      }))

    return rankGameComboboxItems([...knownMatches, ...steamgriddbOnly], q)
  }, [
    searchQuery.data,
    localSearchQuery.data,
    debouncedQuery,
    inputValue,
    value,
  ])

  // Base UI tracks the controlled `value` by identity (useValueChanged), so
  // this object must stay referentially stable across renders — recreating it
  // inline re-fires Base UI's value-changed layout effect on every render and
  // loops until React aborts with "Maximum update depth exceeded".
  const committedValue = useMemo<GameComboboxItem | null>(
    () =>
      value
        ? {
            id: value.id,
            name: value.name,
            releaseDate: value.releaseDate,
            iconUrl: value.iconUrl,
            logoUrl: value.logoUrl,
            game: value,
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

  const resolving = resolveMutation.isPending
  const isDisabled = disabled || resolving

  return (
    <div ref={attachAnchor} className={cn("relative", className)}>
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
          aria-label={t("Game")}
          aria-busy={
            localSearchQuery.isFetching ||
            searchQuery.isFetching ||
            resolving ||
            undefined
          }
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
                  setPage({
                    query: debouncedQuery,
                    count: Math.min(
                      visibleCount + PAGE_SIZE,
                      effectiveItems.length,
                    ),
                  })
                }}
                className={cn(
                  "flex w-full items-center justify-center rounded-md py-2 text-xs",
                  "text-foreground-muted hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {tp(
                  Math.min(PAGE_SIZE, effectiveItems.length - visibleCount),
                  "Show one more",
                  "Show {count} more",
                )}
              </button>
            ) : null}
            <ComboboxEmpty>
              {localSearchQuery.isError
                ? t("Couldn't load games")
                : searchQuery.isError
                  ? t("Couldn't reach SteamGridDB")
                  : debouncedQuery.trim().length === 0
                    ? t("Start typing to search")
                    : t("No matches")}
            </ComboboxEmpty>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}

function GameSearchResultYear({ item }: { item: GameComboboxItem }) {
  const releaseYear = releaseYearFromGameSearchItem(item)
  if (!releaseYear) return null

  return (
    <span className="text-foreground-faint min-w-0 truncate text-xs">
      {"-"}
      {releaseYear}
    </span>
  )
}

function releaseYearFromGameSearchItem(
  item: Pick<GameComboboxItem, "release_date" | "releaseDate">,
): string | null {
  return (
    releaseYearFromTimestamp(item.release_date) ??
    releaseYearFromDateString(item.releaseDate)
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

      if (item.game) score += 140
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

function releaseYearFromTimestamp(
  value: number | null | undefined,
): string | null {
  if (value == null) return null
  const year = new Date(value * 1000).getUTCFullYear()
  return Number.isFinite(year) ? String(year) : null
}

function releaseYearFromDateString(
  value: string | null | undefined,
): string | null {
  if (!value) return null
  const year = new Date(value).getUTCFullYear()
  return Number.isFinite(year) ? String(year) : null
}
