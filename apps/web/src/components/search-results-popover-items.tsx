import * as React from "react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { cn } from "@workspace/ui/lib/utils"

import {
  clipThumbnailUrl,
  type ClipGameRef,
  type ClipRow,
} from "../lib/clips-api"
import {
  clipGameLabel,
  formatCount,
  hueForGame,
} from "../lib/clip-format"
import type { GameListRow } from "../lib/games-api"
import type { UserListRow } from "../lib/search-api"
import { userChipData } from "../lib/user-display"

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
        "text-xs font-medium text-foreground-faint uppercase tracking-wide",
        "[&_svg]:size-3"
      )}
    >
      {icon}
      {children}
    </div>
  )
}

export function ClipRowItem({
  row,
  active,
  onHover,
  onSelect,
}: {
  row: ClipRow
  active: boolean
  onHover: () => void
  onSelect: () => void
}) {
  const thumb = row.thumbKey ? clipThumbnailUrl(row.id) : null
  const label = clipGameLabel(row)
  return (
    <button
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
        "focus-visible:outline-none"
      )}
    >
      <div className="relative aspect-video w-16 shrink-0 overflow-hidden rounded-sm bg-surface-sunken">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <ThumbPlaceholder gameRef={row.gameRef} label={label} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm font-medium",
            active ? "text-accent" : "text-foreground"
          )}
        >
          {row.title}
        </div>
        <div className="truncate text-xs text-foreground-faint">
          <span className="text-foreground-dim">{label}</span>
          <span className="mx-1.5 text-foreground-faint/60">·</span>
          <span>@{row.authorUsername}</span>
          <span className="mx-1.5 text-foreground-faint/60">·</span>
          <span>{formatCount(row.viewCount)} views</span>
        </div>
      </div>
    </button>
  )
}

export function GameRowItem({
  row,
  active,
  onHover,
  onSelect,
}: {
  row: GameListRow
  active: boolean
  onHover: () => void
  onSelect: () => void
}) {
  return (
    <button
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
        "focus-visible:outline-none"
      )}
    >
      <div className="relative aspect-video w-16 shrink-0 overflow-hidden rounded-sm bg-surface-sunken">
        {row.heroUrl ? (
          <img
            src={row.heroUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <GameThumbPlaceholder name={row.name} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm font-medium",
            active ? "text-accent" : "text-foreground"
          )}
        >
          {row.name}
        </div>
        <div className="truncate text-xs text-foreground-faint">
          {row.clipCount} {row.clipCount === 1 ? "clip" : "clips"}
        </div>
      </div>
    </button>
  )
}

export function UserRowItem({
  row,
  active,
  onHover,
  onSelect,
}: {
  row: UserListRow
  active: boolean
  onHover: () => void
  onSelect: () => void
}) {
  const chip = userChipData(row)
  const handle = row.displayUsername || row.username
  return (
    <button
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
        "focus-visible:outline-none"
      )}
    >
      <Avatar size="lg" className="rounded-[3px]">
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
            active ? "text-accent" : "text-foreground"
          )}
        >
          {chip.name}
        </div>
        <div className="truncate text-xs text-foreground-faint">
          <span className="text-foreground-dim">
            @{handle}
          </span>
          <span className="mx-1.5 text-foreground-faint/60">·</span>
          <span>{row.clipCount} {row.clipCount === 1 ? "clip" : "clips"}</span>
        </div>
      </div>
    </button>
  )
}

function ThumbPlaceholder({
  gameRef,
  label,
}: {
  gameRef: ClipGameRef | null
  label: string
}) {
  if (gameRef?.heroUrl) {
    return (
      <img
        src={gameRef.heroUrl}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover opacity-80"
      />
    )
  }
  const hue = hueForGame(label)
  return (
    <div
      className="h-full w-full"
      style={{
        background: `linear-gradient(140deg, oklch(0.3 0.12 ${hue}), oklch(0.15 0.06 ${hue}))`,
      }}
    />
  )
}

function GameThumbPlaceholder({ name }: { name: string }) {
  const hue = hueForGame(name)
  return (
    <div
      className="h-full w-full"
      style={{
        background: `linear-gradient(140deg, oklch(0.32 0.14 ${hue}), oklch(0.16 0.06 ${hue}))`,
      }}
    />
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
      <span className="mt-0.5 text-foreground-faint [&_svg]:size-4">
        {icon}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-foreground-faint">{hint}</span>
      </div>
    </div>
  )
}

export function quote(s: string): string {
  return `"${s}"`
}
