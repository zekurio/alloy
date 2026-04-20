import * as React from "react"
import { Link } from "@tanstack/react-router"
import {
  GlobeIcon,
  HeartIcon,
  Link2Icon,
  LockIcon,
  MessageSquareIcon,
  PencilIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { toast } from "@workspace/ui/components/sonner"
import { cn } from "@workspace/ui/lib/utils"

import { useSession } from "../lib/auth-client"
import {
  useDeleteClipMutation,
  useLikeStateQuery,
  useToggleLikeMutation,
  useUpdateClipMutation,
} from "../lib/clip-queries"
import type { ClipGameRef, ClipPrivacy } from "../lib/clips-api"
import { formatCount } from "../lib/clip-format"
import type { GameRow } from "../lib/games-api"

import { GameCombobox } from "./game-combobox"

/**
 * Uploader details + action bar that sits under the clip player.
 *
 * Cribs the YouTube watch-page layout: the title hangs by itself at the
 * top, and underneath we pack uploader identity on the left and engagement
 * actions on the right. The game badge + posted time + privacy collapse
 * into a metadata strip above the title.
 *
 * Edit affordance (owner-only): each editable surface — title, game
 * badge, description, privacy badge — flips to its own input on click.
 * No global edit mode, no Save/Cancel row, no content shift on entry.
 * Enter commits, Escape reverts, blur commits a non-empty change.
 * Privacy is a popover menu rather than an inline swap so the badge box
 * doesn't grow into the picker. Errors toast and revert.
 *
 * Why per-field instead of a modal: re-trim isn't supported yet, so a
 * modal would be a metadata-only form that drops the player. Inline
 * edits keep the user in context and skip the modal scaffolding for
 * now. When re-trimming lands we'll lift this into a real edit modal
 * (with the player + trim UI) and drop the per-field state.
 */
interface ClipMetaProps {
  /** Clip id — powers each field's PATCH and the delete action. */
  clipId: string
  /**
   * Uploader's stable user id. Gates the owner-only affordances
   * (editable surfaces) against the viewer's session. Admins bypass
   * the owner check for delete only.
   */
  authorId: string
  title: string
  /**
   * Game display label. Comes through `clip-format.ts` which coerces
   * null to "Uncategorised", so this is always a non-empty string at
   * render time. Used as the visible text on the badge.
   */
  game: string
  /**
   * Mapped SGDB game reference when set — drives both the `/g/:slug`
   * link on the badge (for viewers) and the combobox's initial value
   * (for owner-editors). `null` for clips with no mapped game (legacy
   * text-only rows or fresh uploads left uncategorised).
   */
  gameRef: ClipGameRef | null
  /**
   * Author-supplied description. Rendered below the action bar when
   * non-empty; owners also see a faint "Add a description…" placeholder
   * when empty so they have a click target.
   */
  description: string | null
  /** Real privacy value. Pill + popover menu are owner-gated inside. */
  privacy: ClipPrivacy
  views: string
  postedAt: string
  uploader: {
    /** Username handle — drives `/u/:handle` profile links. */
    handle: string
    name: string
    avatar: {
      initials: string
      /** Uploader's real avatar URL — falls through to initials on miss. */
      src?: string
      bg?: string
      fg?: string
    }
  }
  likes: number
  comments: number
}

const PRIVACY_LABELS: Record<
  ClipPrivacy,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  public: { label: "Public", icon: GlobeIcon },
  unlisted: { label: "Unlisted", icon: Link2Icon },
  private: { label: "Private", icon: LockIcon },
}

function ClipMeta({
  clipId,
  authorId,
  title,
  game,
  gameRef,
  description,
  privacy,
  views,
  postedAt,
  uploader,
  likes,
  comments,
}: ClipMetaProps) {
  const { data: session } = useSession()
  // Owner gets the editable surfaces. Admins additionally get delete;
  // they can't edit (we haven't signed off on admins rewriting someone
  // else's title yet).
  const viewerId = session?.user?.id ?? null
  const viewerRole =
    (session?.user as { role?: string | null } | undefined)?.role ?? null
  const isOwner = viewerId !== null && viewerId === authorId
  const isAdmin = viewerRole === "admin"
  const canEdit = isOwner
  const canDelete = isOwner || isAdmin
  const canLike = viewerId !== null

  const deleteMutation = useDeleteClipMutation()
  const deleting = deleteMutation.isPending

  // Per-viewer like state — separate query from the feed payload because
  // the feed only ships the aggregated `likeCount`, not a `liked`
  // boolean. Disabled for anon so we don't 401 needlessly; the button is
  // hidden for them anyway.
  const likeStateQuery = useLikeStateQuery(clipId, { enabled: canLike })
  const likeMutation = useToggleLikeMutation()
  // Prefer the mutation's pending `nextLiked` during the microtask gap
  // between `mutate()` and the optimistic cache write — same pattern as
  // `EditableTitle`. Keeps the heart from flashing through the old state
  // on a fast re-click.
  const pendingLiked =
    likeMutation.isPending && likeMutation.variables?.clipId === clipId
      ? likeMutation.variables.nextLiked
      : undefined
  const liked = pendingLiked ?? likeStateQuery.data?.liked ?? false

  const handleLikeToggle = React.useCallback(() => {
    if (!canLike) return
    likeMutation.mutate(
      { clipId, nextLiked: !liked },
      {
        onError: (err) =>
          toast.error("Couldn't update like", {
            description:
              err instanceof Error ? err.message : "Please try again.",
          }),
      }
    )
  }, [canLike, clipId, liked, likeMutation])

  const handleDelete = React.useCallback(() => {
    // Plain confirm() — matches the "are you sure" affordance used by
    // the profile actions. Upgrade to a proper dialog when the first
    // non-delete destructive action lands.
    if (!window.confirm("Delete this clip? This can't be undone.")) return
    // Mutation removes the row from every cached feed optimistically and
    // invalidates on settle, so the parent feeds drop the card without
    // needing a router-level refetch.
    deleteMutation.mutate(
      { clipId },
      {
        onSuccess: () => toast.success("Clip deleted"),
        onError: (err) =>
          toast.error("Couldn't delete clip", {
            description:
              err instanceof Error ? err.message : "Please try again.",
          }),
      }
    )
  }, [clipId, deleteMutation])

  // `likes` already reflects the optimistic per-clip counter patch from
  // `useToggleLikeMutation` (which nudges every cached feed row by ±1),
  // so it's the authoritative display number here. No local add needed.
  const likeCount = likes

  const avatarStyle = {
    background: uploader.avatar.bg ?? "var(--neutral-200)",
    color: uploader.avatar.fg ?? "var(--foreground)",
  } as const

  return (
    <section className="flex flex-col gap-3">
      {/* ── Top row: game / posted / privacy ─────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <EditableGame
          clipId={clipId}
          displayName={game}
          gameRef={gameRef}
          canEdit={canEdit}
        />
        <Badge variant="ghost">{postedAt}</Badge>
        {canEdit ? (
          <PrivacyBadgeMenu
            clipId={clipId}
            value={privacy}
            className="ml-auto"
          />
        ) : null}
      </div>

      {/* ── Title ────────────────────────────────────────────── */}
      <EditableTitle clipId={clipId} value={title} canEdit={canEdit} />

      {/* ── YouTube-style row: uploader on left, actions on right ─ */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* Uploader identity + profile link */}
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/u/$username"
            params={{ username: uploader.handle }}
            aria-label={`Open ${uploader.name}'s profile`}
            className={cn(
              "shrink-0 rounded-md",
              "transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
            )}
          >
            <Avatar size="xl" style={avatarStyle}>
              {uploader.avatar.src ? (
                <AvatarImage src={uploader.avatar.src} alt={uploader.name} />
              ) : null}
              <AvatarFallback style={avatarStyle}>
                {uploader.avatar.initials}
              </AvatarFallback>
            </Avatar>
          </Link>

          <div className="flex min-w-0 flex-col leading-tight">
            <Link
              to="/u/$username"
              params={{ username: uploader.handle }}
              className={cn(
                "inline-flex items-center gap-1.5 text-lg font-semibold tracking-[-0.01em] text-foreground",
                "hover:text-accent",
                "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                "focus-visible:text-accent focus-visible:outline-none"
              )}
            >
              <span className="truncate">@{uploader.name}</span>
            </Link>
            <span className="mt-1 text-xs text-foreground-faint">
              <span className="text-foreground-muted">{views}</span> views
            </span>
          </div>
        </div>

        {/* Engagement actions — ghost pills by default so the bar reads
            as quiet affordances rather than chunky CTAs. Toggled states
            (liked / bookmarked) promote to `accent-outline` to signal
            they're "on", which is the only place we want pull. */}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={liked ? "accent-outline" : "ghost"}
            size="default"
            onClick={handleLikeToggle}
            disabled={!canLike || likeMutation.isPending}
            aria-pressed={liked}
            aria-label={canLike ? "Like clip" : "Sign in to like"}
            title={canLike ? undefined : "Sign in to like"}
          >
            <HeartIcon className={cn(liked && "fill-current")} />
            <span className="font-mono tracking-[0.04em]">
              {formatCount(likeCount)}
            </span>
          </Button>

          <Button
            variant="ghost"
            size="default"
            onClick={() => {
              const el = document.querySelector<HTMLTextAreaElement>(
                "[data-slot='comment-input']"
              )
              el?.focus()
            }}
            aria-label="Jump to comments"
          >
            <MessageSquareIcon />
            <span className="font-mono tracking-[0.04em]">
              {formatCount(comments)}
            </span>
          </Button>

          <Button variant="ghost" size="default">
            <Share2Icon />
            Share
          </Button>

          {canDelete ? (
            <Button
              variant="ghost"
              size="default"
              onClick={handleDelete}
              disabled={deleting}
              aria-label="Delete clip"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2Icon />
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* ── Description block ─────────────────────────────────
          View mode renders the paragraph when non-empty; owners with an
          empty description still see a faint "Add a description…"
          placeholder so they have a click target. Non-owners with an
          empty description see nothing. */}
      <EditableDescription
        clipId={clipId}
        value={description}
        canEdit={canEdit}
      />
    </section>
  )
}

// ─── Editable surfaces ────────────────────────────────────────────────

/**
 * h1 ↔ borderless input. The input is styled to match the h1's box so
 * entering edit mode doesn't shift any siblings; a focus outline (not a
 * border or ring with offset) signals the active state without resizing
 * the box. Pencil icon fades in on hover, positioned absolutely so its
 * appearance doesn't reflow the title either.
 */
function EditableTitle({
  clipId,
  value,
  canEdit,
}: {
  clipId: string
  value: string
  canEdit: boolean
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const mutation = useUpdateClipMutation()
  const saving = mutation.isPending
  // `mutation.variables` is populated synchronously when `mutate()` is
  // called, but `onMutate` (where the cache patch lands) runs on a
  // microtask after. Preferring the pending value during that gap
  // prevents the "flash of stale prop" when flipping back to view mode.
  // One render later the parent re-renders with the patched prop and
  // this fallback becomes a no-op.
  const pendingTitle =
    mutation.isPending && mutation.variables?.clipId === clipId
      ? mutation.variables.input.title
      : undefined
  const displayValue = pendingTitle ?? value

  // Keep the draft mirrored to fresh server values *only when the user
  // isn't actively editing* — otherwise a router invalidation mid-edit
  // would clobber their typing.
  React.useEffect(() => {
    if (!editing) setDraft(value)
  }, [editing, value])

  // Autofocus + select on entry so the user can immediately overtype.
  React.useEffect(() => {
    if (editing) {
      const el = inputRef.current
      if (el) {
        el.focus()
        el.select()
      }
    }
  }, [editing])

  const cancel = () => {
    setDraft(value)
    setError(null)
    setEditing(false)
  }

  const commit = () => {
    const trimmed = draft.trim()
    // Empty title is invalid — bail without saving. The `commit` path is
    // shared by Enter and blur; Enter shows the inline error first and
    // keeps edit mode open, blur silently reverts (handled by callers).
    if (!trimmed) {
      setDraft(value)
      setError(null)
      setEditing(false)
      return
    }
    if (trimmed === value) {
      setEditing(false)
      setError(null)
      return
    }
    setError(null)
    // Optimistic path: the mutation patches every cached clip row on
    // `onMutate`, so the feed card + dialog header flip immediately.
    // `onError` inside the mutation restores the snapshot; we still toast
    // the message here to tell the user what bounced.
    mutation.mutate(
      { clipId, input: { title: trimmed } },
      {
        onError: (err) => {
          toast.error("Couldn't save title", {
            description:
              err instanceof Error ? err.message : "Please try again.",
          })
          setDraft(value)
        },
      }
    )
    setEditing(false)
  }

  if (!canEdit) {
    return (
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
        {displayValue}
      </h1>
    )
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              if (!draft.trim()) {
                setError("Title can't be empty.")
                return
              }
              void commit()
            } else if (e.key === "Escape") {
              e.preventDefault()
              cancel()
            }
          }}
          onBlur={() => void commit()}
          maxLength={100}
          disabled={saving}
          aria-label="Title"
          aria-invalid={error !== null}
          // Same typography/box as the h1 so siblings don't move.
          // `outline` (not border/ring) keeps focus state out of the
          // layout. `outline-offset-4` lets the ring breathe without
          // touching adjacent rows.
          className={cn(
            "block w-full bg-transparent text-2xl font-semibold tracking-[-0.02em] text-foreground",
            "rounded-sm border-0 p-0",
            "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-border",
            saving && "opacity-60"
          )}
        />
        {error ? (
          <span
            className="font-mono text-2xs text-destructive"
            aria-live="polite"
          >
            {error}
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label="Edit title"
      className={cn(
        // `w-fit` so the button hugs the title text — keeps the pencil
        // sitting just past the last character instead of pinned to the
        // section's right edge.
        "group/title inline-flex w-fit items-center text-left",
        "cursor-text rounded-sm",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-border"
      )}
    >
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
        {displayValue}
      </h1>
      {/* Pencil reserves its slot in flow (opacity, not display) so the
          title doesn't shift when it fades in on hover. */}
      <PencilIcon
        aria-hidden
        className={cn(
          "ml-2 size-4 shrink-0",
          "text-foreground-faint opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "group-hover/title:opacity-100 group-focus-visible/title:opacity-100"
        )}
      />
    </button>
  )
}

/**
 * Game badge — links to `/g/:slug` for viewers, opens an SGDB-backed
 * combobox in a popover for owners. The badge itself stays the same
 * small pill the header row expects so the other badges (posted-at,
 * privacy) don't jump when the picker opens — the combobox lives in
 * the popover body, not inline.
 *
 * Optimistic display: a successful pick flips the prop via
 * `useUpdateClipMutation`'s `onSuccess`, which patches every cached
 * feed row's `gameRef`. Between `mutate()` and the server round-trip
 * landing that patch, we render `pendingRow?.name` (the combobox
 * handed us the full `GameRow` on pick) so the badge doesn't blink
 * back to the previous label.
 */
function EditableGame({
  clipId,
  displayName,
  gameRef,
  canEdit,
}: {
  clipId: string
  displayName: string
  gameRef: ClipGameRef | null
  canEdit: boolean
}) {
  const [open, setOpen] = React.useState(false)
  // `undefined` = no in-flight change, `null` = pending clear, `GameRow`
  // = pending pick. Falls back to the prop once the mutation settles so
  // we don't hold stale local state past the server roundtrip.
  const [pendingRow, setPendingRow] = React.useState<
    GameRow | null | undefined
  >(undefined)
  const mutation = useUpdateClipMutation()
  const saving = mutation.isPending

  // Drop the pending row once the mutation finishes — by then the prop
  // reflects the server-canonical state via `patchClipInCaches` in the
  // mutation's `onSuccess`. Using a watcher on `isPending` (not a
  // per-call callback) covers retry + rollback paths uniformly.
  React.useEffect(() => {
    if (!mutation.isPending) setPendingRow(undefined)
  }, [mutation.isPending])

  // Resolve the label the badge should show. Pending pick wins over the
  // prop so a just-selected game appears immediately; pending clear
  // shows the placeholder label; otherwise fall through to the prop
  // (already coerced via `clipGameLabel`).
  const effectiveLabel =
    pendingRow === null
      ? "Uncategorised"
      : pendingRow
        ? pendingRow.name
        : displayName
  const effectiveSlug =
    pendingRow === null
      ? null
      : pendingRow
        ? pendingRow.slug
        : (gameRef?.slug ?? null)

  // Shape the combobox's initial value from the row-level `gameRef` (or
  // the pending pick when the user just selected something). The
  // combobox only needs a `GameRow`-shaped object — `releaseDate` isn't
  // surfaced from `gameRef` so we synthesise `null`, which the picker
  // doesn't display for the selected value anyway.
  const initialValue: GameRow | null =
    pendingRow !== undefined
      ? pendingRow
      : gameRef
        ? {
            id: gameRef.id,
            steamgriddbId: gameRef.steamgriddbId,
            name: gameRef.name,
            slug: gameRef.slug,
            releaseDate: null,
            heroUrl: gameRef.heroUrl,
            logoUrl: gameRef.logoUrl,
          }
        : null

  const commit = React.useCallback(
    (row: GameRow | null) => {
      const nextGameId = row?.id ?? null
      const currentGameId = gameRef?.id ?? null
      if (nextGameId === currentGameId) {
        // No-op pick (user re-selected the current game or cleared an
        // already-empty field). Close the popover and leave mutation
        // state alone.
        setOpen(false)
        return
      }
      setPendingRow(row)
      mutation.mutate(
        { clipId, input: { gameId: nextGameId } },
        {
          onError: (err) => {
            setPendingRow(undefined)
            toast.error("Couldn't save game", {
              description:
                err instanceof Error ? err.message : "Please try again.",
            })
          },
        }
      )
      setOpen(false)
    },
    [clipId, gameRef?.id, mutation]
  )

  // Viewer-facing view: plain badge when unmapped, linked badge when
  // mapped. Legacy text-only rows hit the unmapped branch because
  // `gameRef` is null even though the label prop is a non-empty string.
  if (!canEdit) {
    if (gameRef) {
      return (
        <Link
          to="/g/$slug"
          params={{ slug: gameRef.slug }}
          className={cn(
            "rounded-md transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "hover:opacity-80 focus-visible:outline-none"
          )}
        >
          <Badge variant="accent">{effectiveLabel}</Badge>
        </Link>
      )
    }
    return <Badge variant="accent">{effectiveLabel}</Badge>
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Edit game"
            className={cn(
              "group/game inline-flex cursor-pointer rounded-md",
              "transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "focus-visible:outline-none",
              "hover:[&>span]:bg-accent-soft/80",
              "focus-visible:[&>span]:outline focus-visible:[&>span]:outline-2 focus-visible:[&>span]:outline-offset-2 focus-visible:[&>span]:outline-accent-border",
              saving && "opacity-60"
            )}
          />
        }
      >
        <Badge variant="accent">{effectiveLabel}</Badge>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] gap-2 p-2">
        <GameCombobox
          value={initialValue}
          onChange={commit}
          disabled={saving}
        />
        {/* Only show the link-out once the selection is committed. While
            a pick is in-flight, the slug points at a row that may not
            exist in the caches yet — the hero would 404 on first click. */}
        {effectiveSlug && !saving ? (
          <Link
            to="/g/$slug"
            params={{ slug: effectiveSlug }}
            className={cn(
              "rounded-sm px-2 py-1 text-xs text-foreground-muted",
              "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "hover:bg-surface-raised hover:text-foreground"
            )}
          >
            Open game page →
          </Link>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Description paragraph ↔ textarea.
 *
 * View modes:
 *   • non-empty: <p> with the current text
 *   • empty + owner: faint "Add a description…" placeholder paragraph
 *     so the owner has a click target
 *   • empty + non-owner: nothing (matches old behaviour)
 *
 * Edit mode: textarea with Slack-style commit shortcuts — Enter saves,
 * Shift+Enter inserts a newline, Escape cancels, blur saves. Description
 * accepts the empty string as "clear it" (server nulls the column).
 */
function EditableDescription({
  clipId,
  value,
  canEdit,
}: {
  clipId: string
  value: string | null
  canEdit: boolean
}) {
  const current = value ?? ""
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(current)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const mutation = useUpdateClipMutation()
  const saving = mutation.isPending
  // See `EditableTitle` for the rationale. `??` rather than `||` so a
  // deliberate clear ("" submitted to nuke the description) still wins
  // over the prop during the microtask gap.
  const pendingDescription =
    mutation.isPending && mutation.variables?.clipId === clipId
      ? mutation.variables.input.description
      : undefined
  const displayValue = pendingDescription ?? current
  const hasDescription = displayValue.trim().length > 0

  React.useEffect(() => {
    if (!editing) setDraft(current)
  }, [editing, current])

  React.useEffect(() => {
    if (editing) {
      const el = textareaRef.current
      if (el) {
        el.focus()
        // Place caret at end rather than selecting — descriptions are
        // multi-line and "select all on focus" would be aggressive.
        const len = el.value.length
        el.setSelectionRange(len, len)
      }
    }
  }, [editing])

  const cancel = () => {
    setDraft(current)
    setEditing(false)
  }

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === current) {
      setEditing(false)
      return
    }
    // Empty string is a deliberate clear — server nulls the column.
    mutation.mutate(
      { clipId, input: { description: trimmed } },
      {
        onError: (err) => {
          toast.error("Couldn't save description", {
            description:
              err instanceof Error ? err.message : "Please try again.",
          })
          setDraft(current)
        },
      }
    )
    setEditing(false)
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            void commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            cancel()
          }
        }}
        onBlur={() => void commit()}
        rows={3}
        maxLength={2000}
        disabled={saving}
        placeholder="Add a description — Enter to save, Shift+Enter for a newline."
        aria-label="Description"
        className={cn(
          "w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-base leading-relaxed text-foreground",
          "transition-[border-color,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "placeholder:text-foreground-faint",
          "hover:border-border-strong",
          "focus-visible:border-accent-border focus-visible:bg-surface-raised focus-visible:outline-none",
          saving && "opacity-60"
        )}
      />
    )
  }

  if (!hasDescription && !canEdit) return null

  if (!hasDescription) {
    // Owner with empty description — faint placeholder + click target.
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          "group/desc -mx-2 flex w-fit items-center gap-2 rounded-md px-2 py-1 text-left",
          "text-base text-foreground-faint italic",
          "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "hover:text-foreground-muted",
          "focus-visible:text-foreground-muted focus-visible:outline-none"
        )}
        aria-label="Add a description"
      >
        Add a description…
        <PencilIcon
          aria-hidden
          className="size-3.5 opacity-0 transition-opacity group-hover/desc:opacity-60 group-focus-visible/desc:opacity-60"
        />
      </button>
    )
  }

  if (!canEdit) {
    return (
      <p className="text-base leading-relaxed whitespace-pre-wrap text-foreground-muted">
        {displayValue}
      </p>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label="Edit description"
      className={cn(
        "group/desc relative -mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left",
        "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:bg-surface-sunken",
        "focus-visible:bg-surface-sunken focus-visible:outline-none",
        "cursor-text"
      )}
    >
      <p className="text-base leading-relaxed whitespace-pre-wrap text-foreground-muted">
        {displayValue}
      </p>
      <PencilIcon
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1.5 right-2 size-3.5",
          "text-foreground-faint opacity-0 transition-opacity",
          "group-hover/desc:opacity-100 group-focus-visible/desc:opacity-100"
        )}
      />
    </button>
  )
}

/**
 * Privacy badge that opens a popover with the three options. Selecting
 * one fires the PATCH and closes the popover. We use a popover (rather
 * than swapping the badge inline for the segmented `VisibilityPicker`)
 * so the badge box stays badge-sized — the picker is much wider and
 * would shift the row siblings.
 */
function PrivacyBadgeMenu({
  clipId,
  value,
  className,
}: {
  clipId: string
  value: ClipPrivacy
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const mutation = useUpdateClipMutation()
  const saving = mutation.isPending
  // Bridge the microtask gap between `mutate()` and the cache patch so
  // the trigger's icon+label don't blink to the old value on close.
  // See `EditableTitle` for the longer explanation.
  const pendingPrivacy =
    mutation.isPending && mutation.variables?.clipId === clipId
      ? mutation.variables.input.privacy
      : undefined
  const displayValue = pendingPrivacy ?? value
  const display = PRIVACY_LABELS[displayValue]
  const Icon = display.icon

  const choose = (next: ClipPrivacy) => {
    setOpen(false)
    if (next === value) return
    mutation.mutate(
      { clipId, input: { privacy: next } },
      {
        onError: (err) =>
          toast.error("Couldn't update visibility", {
            description:
              err instanceof Error ? err.message : "Please try again.",
          }),
      }
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Badge
            variant="default"
            className={cn(
              "cursor-pointer transition-opacity hover:bg-surface-raised/80",
              saving && "opacity-60",
              className
            )}
            aria-label={`Visibility: ${display.label}. Click to change.`}
          />
        }
      >
        <Icon />
        {display.label}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 gap-0.5 p-1">
        {(Object.keys(PRIVACY_LABELS) as Array<ClipPrivacy>).map((key) => {
          const info = PRIVACY_LABELS[key]
          const ItemIcon = info.icon
          const active = key === value
          return (
            <button
              key={key}
              type="button"
              onClick={() => void choose(key)}
              aria-pressed={active}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                active
                  ? "bg-accent-soft text-accent"
                  : "text-foreground-muted hover:bg-surface-raised hover:text-foreground"
              )}
            >
              <ItemIcon className="size-3.5" />
              {info.label}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

export { ClipMeta, type ClipMetaProps }
