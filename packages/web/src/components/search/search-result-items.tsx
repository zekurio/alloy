import { type ClipRow, clipThumbnailUrl, type GameListRow } from "@alloy/api"
import { t as tx } from "@alloy/i18n"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
import { MediaPlaceholder } from "@alloy/ui/components/media-placeholder"
import { Skeleton } from "@alloy/ui/components/skeleton"
import {
  CLIP_MEDIA_CLASS,
  CLIP_MEDIA_VIEWPORT_CLASS,
} from "@alloy/ui/lib/media-frame"
import { cn } from "@alloy/ui/lib/utils"
import * as React from "react"

import { clipGameLabel } from "@/lib/clip-format"
import { apiOrigin } from "@/lib/env"
import { formatCount } from "@/lib/number-format"
import type { UserListRow } from "@/lib/search-api"
import { userChipData } from "@/lib/user-display"

export function GroupLabel({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-3 pt-2 pb-1",
        "text-xs font-semibold tracking-wide text-foreground-muted uppercase",
        "[&_svg]:size-3",
      )}
    >
      {icon}
      {children}
    </div>
  )
}

function RowButton({
  id,
  active,
  onHover,
  onSelect,
  children,
}: {
  id: string
  active: boolean
  onHover: () => void
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onFocus={onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-center gap-3 px-3 py-2 text-left",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        active ? "bg-accent-soft" : "bg-transparent",
        "hover:bg-accent-soft focus-visible:bg-accent-soft",
        "focus-visible:outline-none",
      )}
    >
      {children}
    </button>
  )
}

export function ClipRowItem({
  id,
  row,
  active,
  onHover,
  onSelect,
}: {
  id: string
  row: ClipRow
  active: boolean
  onHover: () => void
  onSelect: () => void
}) {
  const thumb = row.thumbKey
    ? clipThumbnailUrl(row.id, apiOrigin(), row.updatedAt)
    : null
  const label = clipGameLabel(row)
  return (
    <RowButton id={id} active={active} onHover={onHover} onSelect={onSelect}>
      <div
        className={cn(
          CLIP_MEDIA_VIEWPORT_CLASS,
          "w-16 shrink-0 rounded-sm bg-surface-sunken",
        )}
      >
        <MediaPlaceholder
          seed={row.steamgriddbId ?? row.id}
          blurHash={row.thumbBlurHash}
        />
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" className={CLIP_MEDIA_CLASS} />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm font-medium",
            active ? "text-accent" : "text-foreground",
          )}
        >
          {row.title}
        </div>
        <div className="text-foreground-muted flex items-center gap-2 truncate text-xs font-semibold">
          <span>{label}</span>
          <span>@{row.authorUsername}</span>
          <span>
            {formatCount(row.viewCount)} {tx("views")}
          </span>
        </div>
      </div>
    </RowButton>
  )
}

export function GameRowItem({
  id,
  row,
  active,
  onHover,
  onSelect,
}: {
  id: string
  row: GameListRow
  active: boolean
  onHover: () => void
  onSelect: () => void
}) {
  return (
    <RowButton id={id} active={active} onHover={onHover} onSelect={onSelect}>
      <div className="bg-surface-sunken relative aspect-video w-16 shrink-0 overflow-hidden rounded-sm">
        <MediaPlaceholder
          seed={row.steamgriddbId}
          blurHash={row.heroBlurHash}
        />
        {row.heroUrl ? (
          <img
            src={row.heroUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm font-medium",
            active ? "text-accent" : "text-foreground",
          )}
        >
          {row.name}
        </div>
        <div className="text-foreground-muted truncate text-xs font-semibold">
          {formatCount(row.clipCount)}{" "}
          {row.clipCount === 1 ? tx("clip") : tx("clips")}
        </div>
      </div>
    </RowButton>
  )
}

export function UserRowItem({
  id,
  row,
  active,
  onHover,
  onSelect,
}: {
  id: string
  row: UserListRow
  active: boolean
  onHover: () => void
  onSelect: () => void
}) {
  const chip = userChipData(row)
  const handle = row.displayUsername || row.username
  return (
    <RowButton id={id} active={active} onHover={onHover} onSelect={onSelect}>
      <Avatar size="lg" className="rounded-full">
        {chip.avatar.src ? <AvatarImage src={chip.avatar.src} alt="" /> : null}
        <AvatarFallback
          style={{
            backgroundColor: chip.avatar.bg,
            color: chip.avatar.fg,
          }}
        >
          {chip.avatar.initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm font-medium",
            active ? "text-accent" : "text-foreground",
          )}
        >
          {chip.name}
        </div>
        <div className="text-foreground-muted flex items-center gap-2 truncate text-xs font-semibold">
          <span>@{handle}</span>
          <span>
            {formatCount(row.clipCount)}{" "}
            {row.clipCount === 1 ? tx("clip") : tx("clips")}
          </span>
        </div>
      </div>
    </RowButton>
  )
}

/**
 * Thin indeterminate bar pinned to the top edge of the results popover. It
 * conveys "a fresh search is in flight" without shifting layout or replacing
 * already-rendered results, so typing stays visually quiet.
 */
export function SearchLoadingBar() {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden"
      aria-hidden
    >
      <div className="animate-indeterminate bg-accent h-full w-1/4 rounded-full" />
    </div>
  )
}

/**
 * Placeholder rows shown only on the first paint of a query — when there are
 * no prior results to keep visible. Reads as "content arriving" rather than a
 * spinner, which makes the popover feel instant while the request lands.
 */
export function SearchResultsSkeleton() {
  return (
    <div className="flex flex-col py-1" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => i).map((i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2">
          <Skeleton className="aspect-video w-16 shrink-0 rounded-sm" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmptyBlock({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode
  title: string
  hint: string
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-4">
      <span className="text-foreground-muted mt-0.5 [&_svg]:size-4">
        {icon}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-foreground text-sm font-semibold">{title}</span>
        <span className="text-foreground-muted text-xs font-semibold">
          {hint}
        </span>
      </div>
    </div>
  )
}
