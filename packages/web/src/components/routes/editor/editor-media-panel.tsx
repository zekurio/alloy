import type { ClipRow } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@alloy/ui/components/input-group"
import { cn } from "@alloy/ui/lib/utils"
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  CloudIcon,
  LibraryIcon,
  PaletteIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react"
import * as React from "react"

import { ClipDownloadIconButton } from "@/components/clip/clip-download-button"
import { formatMediaDurationMs } from "@/lib/media-time"

import {
  EDITOR_FILTER_PRESETS,
  editorFilterPreset,
  type EditorFilterId,
  type EditorFilterPreset,
} from "./editor-filters"

/** One addable media row: a local capture or an uploaded ("cloud") clip. */
export interface EditorMediaItem {
  id: string
  title: string
  /** Secondary line next to the duration: source group or game name. */
  subtitle: string
  durationMs: number | null
  thumbnailUrl: string | null
  /** Extra text the search box matches beyond title + subtitle. */
  searchText: string
  /** True when the media streams from the server (an uploaded clip). */
  cloud: boolean
  /** Full clip row for cloud items — powers the save-to-device action. */
  clipRow?: ClipRow
}

type EditorElementsPanelView = "elements" | "media" | "filters"

/**
 * Multifunction add panel of the editor. Media adds timeline clips; filters
 * select the project's global look for preview and render.
 */
export function EditorMediaPanel({
  filterId,
  items,
  onAdd,
  onFilterChange,
}: {
  filterId: EditorFilterId
  items: EditorMediaItem[]
  onAdd: (item: EditorMediaItem) => void
  onFilterChange: (filterId: EditorFilterId) => void
}) {
  const [view, setView] = React.useState<EditorElementsPanelView>("elements")
  const [query, setQuery] = React.useState("")
  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) =>
      [item.title, item.subtitle, item.searchText]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
  }, [items, query])

  return (
    <aside className="border-border bg-surface/60 flex min-h-0 flex-col overflow-hidden rounded-md border">
      {view === "elements" ? (
        <ElementsHome
          filterTitle={editorFilterPreset(filterId).title}
          itemCount={items.length}
          onSelectView={setView}
        />
      ) : null}
      {view === "media" ? (
        <MediaLibraryView
          items={items}
          visible={visible}
          query={query}
          onQueryChange={setQuery}
          onAdd={onAdd}
          onBack={() => setView("elements")}
        />
      ) : null}
      {view === "filters" ? (
        <FiltersView
          selectedId={filterId}
          onSelect={onFilterChange}
          onBack={() => setView("elements")}
        />
      ) : null}
    </aside>
  )
}

function ElementsHome({
  filterTitle,
  itemCount,
  onSelectView,
}: {
  filterTitle: string
  itemCount: number
  onSelectView: (view: EditorElementsPanelView) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
        <PlusIcon className="text-accent size-4" />
        {tx("Add elements")}
      </div>
      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        <ElementPickerRow
          icon={<LibraryIcon />}
          title={tx("Media")}
          subtitle={tx("{count} {label}", {
            count: itemCount,
            label: itemCount === 1 ? tx("clip") : tx("clips"),
          })}
          onClick={() => onSelectView("media")}
        >
          <div className="bg-surface-raised border-border flex -space-x-1 rounded-md border px-1.5 py-1">
            <span className="bg-accent/80 block size-3 rounded-sm" />
            <span className="block size-3 rounded-sm bg-cyan-500" />
            <span className="block size-3 rounded-sm bg-amber-400" />
          </div>
        </ElementPickerRow>
        <ElementPickerRow
          icon={<PaletteIcon />}
          title={tx("Filters")}
          subtitle={filterTitle}
          onClick={() => onSelectView("filters")}
        >
          <div className="grid grid-cols-2 gap-0.5">
            {EDITOR_FILTER_PRESETS.slice(1, 5).map((preset) => (
              <span
                key={preset.id}
                className={cn("block size-3 rounded-sm", preset.swatches[1])}
              />
            ))}
          </div>
        </ElementPickerRow>
      </div>
    </div>
  )
}

function ElementPickerRow({
  icon,
  title,
  subtitle,
  children,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="border-border bg-surface/50 hover:border-border-strong hover:bg-surface-raised focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3 rounded-md border p-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
      onClick={onClick}
    >
      <span className="border-border bg-surface-raised text-foreground-muted flex size-8 shrink-0 items-center justify-center rounded-md border [&>svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-semibold">
          {title}
        </span>
        <span className="text-foreground-faint block truncate text-xs">
          {subtitle}
        </span>
      </span>
      <span className="shrink-0">{children}</span>
      <ChevronRightIcon className="text-foreground-faint size-4 shrink-0" />
    </button>
  )
}

function PanelHeader({
  icon,
  title,
}: {
  icon: React.ReactNode
  title: string
}) {
  return (
    <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
      <span className="text-accent [&>svg]:size-4">{icon}</span>
      {title}
    </div>
  )
}

function BackToElementsButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      className="border-border text-foreground-muted hover:bg-surface-raised hover:text-foreground focus-visible:ring-ring flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
      onClick={onBack}
    >
      <ArrowLeftIcon className="size-3.5" />
      {tx("Back to elements")}
    </button>
  )
}

function MediaLibraryView({
  items,
  visible,
  query,
  onQueryChange,
  onAdd,
  onBack,
}: {
  items: EditorMediaItem[]
  visible: EditorMediaItem[]
  query: string
  onQueryChange: (query: string) => void
  onAdd: (item: EditorMediaItem) => void
  onBack: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <PanelHeader icon={<LibraryIcon />} title={tx("Media")} />
      <InputGroup className="h-8 sm:h-8">
        <InputGroupAddon align="inline-start">
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          placeholder={tx("Search media...")}
          aria-label={tx("Search media")}
          onChange={(event) => onQueryChange(event.target.value)}
          className="text-sm"
        />
      </InputGroup>

      <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {visible.length === 0 ? (
          <p className="text-foreground-faint px-1 py-4 text-center text-sm">
            {items.length === 0
              ? tx("No clips on this device or in your uploads yet.")
              : tx("No clips match.")}
          </p>
        ) : (
          visible.map((item) => (
            <MediaRow key={item.id} item={item} onAdd={() => onAdd(item)} />
          ))
        )}
      </div>
      <BackToElementsButton onBack={onBack} />
    </div>
  )
}

function FiltersView({
  selectedId,
  onSelect,
  onBack,
}: {
  selectedId: EditorFilterId
  onSelect: (id: EditorFilterId) => void
  onBack: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <PanelHeader icon={<PaletteIcon />} title={tx("Filters")} />
      <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {EDITOR_FILTER_PRESETS.map((preset) => (
          <FilterPresetRow
            key={preset.id}
            preset={preset}
            selected={selectedId === preset.id}
            onSelect={() => onSelect(preset.id)}
          />
        ))}
      </div>
      <BackToElementsButton onBack={onBack} />
    </div>
  )
}

function FilterPresetRow({
  preset,
  selected,
  onSelect,
}: {
  preset: EditorFilterPreset
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "border-border bg-surface/50 hover:border-border-strong hover:bg-surface-raised focus-visible:ring-ring flex w-full cursor-pointer items-center gap-3 rounded-md border p-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
        selected &&
          "border-accent-border bg-accent-soft/60 text-accent hover:border-accent-border hover:bg-accent-soft",
      )}
      onClick={onSelect}
    >
      <span className="border-border bg-surface-raised flex h-9 w-12 shrink-0 overflow-hidden rounded-md border">
        {preset.swatches.map((swatch) => (
          <span key={swatch} className={cn("h-full flex-1", swatch)} />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-semibold">
          {preset.title}
        </span>
        <span className="text-foreground-faint block truncate text-xs">
          {preset.subtitle}
        </span>
      </span>
      <span className="flex size-4 shrink-0 items-center justify-center">
        {selected ? <CheckIcon className="text-accent size-4" /> : null}
      </span>
    </button>
  )
}

function MediaRow({
  item,
  onAdd,
}: {
  item: EditorMediaItem
  onAdd: () => void
}) {
  // The download control is a real button, so the row click lives on its own
  // button underneath instead of wrapping it (no nested interactive elements).
  return (
    <div className="group/media relative">
      <button
        type="button"
        className="hover:bg-surface-raised focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2 rounded-md p-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
        title={tx("Add {title} to the timeline", { title: item.title })}
        onClick={onAdd}
      >
        <div className="bg-surface-raised relative aspect-video w-16 shrink-0 overflow-hidden rounded">
          {item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-xs font-medium">
            {item.title}
          </p>
          <p className="text-foreground-faint flex items-center gap-1 truncate text-xs tabular-nums">
            {item.cloud ? (
              <CloudIcon
                aria-label={tx("Uploaded clip")}
                className="size-3 shrink-0"
              />
            ) : null}
            <span className="truncate">
              {item.durationMs ? formatMediaDurationMs(item.durationMs) : "—"}{" "}
              {"·"} {item.subtitle}
            </span>
          </p>
        </div>
        {/* The row itself is the button; this is just the hover affordance. */}
        <span
          aria-hidden
          className={`bg-surface-raised text-foreground-muted inline-flex size-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity group-hover/media:opacity-100 ${
            item.clipRow ? tx("mr-7") : ""
          }`}
        >
          <PlusIcon className="size-3.5" />
        </span>
      </button>
      {item.clipRow ? (
        <ClipDownloadIconButton
          row={item.clipRow}
          className="absolute top-1/2 right-1.5 size-6 -translate-y-1/2 opacity-0 transition-opacity group-hover/media:opacity-100 focus-visible:opacity-100 disabled:opacity-100"
        />
      ) : null}
    </div>
  )
}
