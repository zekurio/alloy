import {
  type ClipGameRef,
  type ClipRow,
  clipThumbnailUrl,
  type GameListRow,
} from "@workspace/api"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import {
  CLIP_MEDIA_CLASS,
  CLIP_MEDIA_VIEWPORT_CLASS,
} from "@workspace/ui/lib/media-frame"
import { cn } from "@workspace/ui/lib/utils"
import * as React from "react"

import { clipGameLabel, hueForGame } from "@/lib/clip-format"
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
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" className={CLIP_MEDIA_CLASS} />
        ) : (
          <ThumbPlaceholder gameRef={row.gameRef} label={label} />
        )}
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
          <span>{formatCount(row.viewCount)} views</span>
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
            active ? "text-accent" : "text-foreground",
          )}
        >
          {row.name}
        </div>
        <div className="text-foreground-muted truncate text-xs font-semibold">
          {formatCount(row.clipCount)} {row.clipCount === 1 ? "clip" : "clips"}
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
            {row.clipCount === 1 ? "clip" : "clips"}
          </span>
        </div>
      </div>
    </RowButton>
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
  return <GameGradientPlaceholder name={label} startLightness={0.3} />
}

function GameThumbPlaceholder({ name }: { name: string }) {
  return <GameGradientPlaceholder name={name} startLightness={0.32} />
}

function GameGradientPlaceholder({
  name,
  startLightness,
}: {
  name: string
  startLightness: number
}) {
  const hue = hueForGame(name)
  return (
    <div
      className="h-full w-full"
      style={{
        background: `linear-gradient(140deg, oklch(${startLightness} 0.14 ${hue}), oklch(0.16 0.06 ${hue}))`,
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
