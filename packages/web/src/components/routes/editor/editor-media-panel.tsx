import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@alloy/ui/components/input-group"
import { CloudIcon, LibraryIcon, PlusIcon, SearchIcon } from "lucide-react"
import * as React from "react"

import { formatMediaDurationMs } from "@/lib/media-time"

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
}

/**
 * Library panel of the editor: every local video capture plus the user's
 * uploaded clips, addable to the timeline at the playhead. The project's
 * clips are decoupled from these items — adding the same media twice just
 * creates two clips.
 */
export function EditorMediaPanel({
  items,
  onAdd,
}: {
  items: EditorMediaItem[]
  onAdd: (item: EditorMediaItem) => void
}) {
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
    <aside className="border-border bg-surface/60 flex min-h-0 flex-col gap-3 rounded-md border p-3">
      <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
        <LibraryIcon className="text-accent size-4" />
        Library
      </div>
      <InputGroup className="h-8 sm:h-8">
        <InputGroupAddon align="inline-start">
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          placeholder="Search media..."
          aria-label="Search media"
          onChange={(event) => setQuery(event.target.value)}
          className="text-sm"
        />
      </InputGroup>

      <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        {visible.length === 0 ? (
          <p className="text-foreground-faint px-1 py-4 text-center text-sm">
            {items.length === 0
              ? "No clips on this device or in your uploads yet."
              : "No clips match."}
          </p>
        ) : (
          visible.map((item) => (
            <MediaRow key={item.id} item={item} onAdd={() => onAdd(item)} />
          ))
        )}
      </div>
    </aside>
  )
}

function MediaRow({
  item,
  onAdd,
}: {
  item: EditorMediaItem
  onAdd: () => void
}) {
  return (
    <button
      type="button"
      className="group/media hover:bg-surface-raised flex w-full cursor-pointer items-center gap-2 rounded-md p-1.5 text-left transition-colors"
      title={`Add ${item.title} to the timeline`}
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
            <CloudIcon aria-label="Uploaded clip" className="size-3 shrink-0" />
          ) : null}
          <span className="truncate">
            {item.durationMs ? formatMediaDurationMs(item.durationMs) : "—"} ·{" "}
            {item.subtitle}
          </span>
        </p>
      </div>
      {/* The row itself is the button; this is just the hover affordance. */}
      <span
        aria-hidden
        className="bg-surface-raised text-foreground-muted inline-flex size-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity group-hover/media:opacity-100"
      >
        <PlusIcon className="size-3.5" />
      </span>
    </button>
  )
}
