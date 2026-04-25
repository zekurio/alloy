import * as React from "react"
import { Link } from "@tanstack/react-router"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  HeartIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Share2Icon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import {
  DialogClose,
  DialogViewportContent,
} from "@workspace/ui/components/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@workspace/ui/components/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { GameIcon } from "@workspace/ui/components/game-icon"
import { toast } from "@workspace/ui/lib/toast"
import { cn } from "@workspace/ui/lib/utils"

import { clipThumbnailUrl, type ClipRow } from "@workspace/api"

import { api } from "@/lib/api"
import { clipGameLabel, formatCount } from "@/lib/clip-format"
import { useSession } from "@/lib/auth-client"
import {
  useDeleteClipMutation,
  useLikeStateQuery,
  useToggleLikeMutation,
} from "@/lib/clip-queries"
import { avatarTint, displayInitials, userImageSrc } from "@/lib/user-display"

import { ClipComments } from "./clip-comments"
import { ClipEditDialog } from "./clip-edit-dialog"
import type { ClipListEntry } from "./clip-list-context"
import { ClipMentionsRow } from "./clip-mentions-row"
import { renderDescriptionTokens } from "./description-tokens"
import { ClipPlayer } from "./clip-player"

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface MobileClipViewerBodyProps {
  row: ClipRow
  onDeleted?: () => void
  prev?: ClipListEntry | null
  next?: ClipListEntry | null
  onNavigate?: ((entry: ClipListEntry) => void) | null
  autoAdvance: boolean
  onAutoAdvanceChange: (next: boolean) => void
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

function MobileClipViewerBody({
  row,
  onDeleted,
  prev,
  next,
  onNavigate,
  autoAdvance,
  onAutoAdvanceChange,
}: MobileClipViewerBodyProps) {
  const { data: session } = useSession()
  const viewerId = session?.user?.id ?? null
  const viewerRole =
    (session?.user as { role?: string | null } | undefined)?.role ?? null
  const isOwner = viewerId !== null && viewerId === row.authorId
  const isAdmin = viewerRole === "admin"
  const canManage = isOwner || isAdmin
  const canLike = viewerId !== null
  const canNav = Boolean(onNavigate)

  /* ---- derived ---- */
  const handle = row.authorUsername
  const author = row.authorName || handle
  const initials = displayInitials(author)
  const { bg, fg } = avatarTint(row.authorId || handle)
  const gameLabel = clipGameLabel(row)
  const thumbnail = row.thumbKey ? clipThumbnailUrl(row.id) : null
  const avatarSrc = userImageSrc(row.authorImage)
  const gameRef = row.gameRef
  const gameIcon = gameRef?.iconUrl ?? gameRef?.logoUrl ?? null

  /* ---- like state ---- */
  const likeQuery = useLikeStateQuery(row.id, { enabled: canLike })
  const likeMut = useToggleLikeMutation()
  const pendingLiked =
    likeMut.isPending && likeMut.variables?.clipId === row.id
      ? likeMut.variables.nextLiked
      : undefined
  const liked = pendingLiked ?? likeQuery.data?.liked ?? false

  /* ---- edit / delete ---- */
  const [editOpen, setEditOpen] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const deleteMutation = useDeleteClipMutation()
  const deleting = deleteMutation.isPending

  /* ---- comments panel ---- */
  const [commentsOpen, setCommentsOpen] = React.useState(false)

  React.useEffect(() => {
    setCommentsOpen(false)
  }, [row.id])

  /* ---- swipe gesture ---- */
  const touchRef = React.useRef<{ y: number; t: number } | null>(null)

  const onTouchStart = React.useCallback((e: React.TouchEvent) => {
    touchRef.current = { y: e.touches[0]!.clientY, t: Date.now() }
  }, [])

  const onTouchEnd = React.useCallback(
    (e: React.TouchEvent) => {
      if (!touchRef.current) return
      const dy = e.changedTouches[0]!.clientY - touchRef.current.y
      const dt = Date.now() - touchRef.current.t
      touchRef.current = null
      if (dt > 400 || Math.abs(dy) < 60) return
      if (dy < 0 && next && onNavigate) onNavigate(next)
      else if (dy > 0 && prev && onNavigate) onNavigate(prev)
    },
    [next, prev, onNavigate]
  )

  /* ---- handlers ---- */
  const handleLike = React.useCallback(() => {
    if (!canLike) return
    likeMut.mutate(
      { clipId: row.id, nextLiked: !liked },
      { onError: () => toast.error("Couldn't update like") }
    )
  }, [canLike, row.id, liked, likeMut])

  const handleShare = React.useCallback(async () => {
    const url = new URL(window.location.href)
    url.search = ""
    url.hash = ""
    try {
      await navigator.clipboard.writeText(url.toString())
      toast.success("Link copied")
    } catch {
      toast.error("Couldn't copy link")
    }
  }, [])

  const handleDelete = React.useCallback(() => {
    deleteMutation.mutate(
      { clipId: row.id },
      {
        onSuccess: () => {
          toast.success("Clip deleted")
          onDeleted?.()
        },
        onError: () => toast.error("Couldn't delete clip"),
      }
    )
  }, [row.id, deleteMutation, onDeleted])

  const handleEnded = React.useCallback(() => {
    if (autoAdvance && next && onNavigate) onNavigate(next)
  }, [autoAdvance, next, onNavigate])

  const avatarStyle = { background: bg, color: fg } as const

  return (
    <>
      <DialogViewportContent className="h-dvh w-dvw rounded-none border-0 shadow-none">
        <div
          className="relative flex h-full flex-col bg-black"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {/* ---- Blurred thumbnail background (full-screen) ---- */}
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 z-0 size-full scale-[1.2] object-cover blur-2xl brightness-[0.35] saturate-150"
            />
          ) : null}

          {/* ---- Close button ---- */}
          <DialogClose
            className="absolute top-3 right-3 z-30 grid size-8 place-items-center rounded-full bg-black/60 text-white/80 backdrop-blur-sm"
            aria-label="Close"
          >
            <XIcon className="size-5" />
          </DialogClose>

          {/* ---- Top spacer (pushes player toward vertical center) ---- */}
          <div className="flex-1" />

          {/* ---- Prev clip chevron (above video) ---- */}
          <div className="relative z-10 flex shrink-0 justify-center py-1">
            {canNav && prev ? (
              <button
                type="button"
                onClick={() => onNavigate!(prev)}
                className="text-white/50 drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] active:text-white/80"
                aria-label="Previous clip"
              >
                <ChevronUpIcon className="size-7 stroke-[2.5]" />
              </button>
            ) : (
              <div className="size-7" />
            )}
          </div>

          {/* ---- Video player ---- */}
          <div className="relative z-10 shrink-0">
            <ClipPlayer
              clipId={row.id}
              sourceContentType={row.contentType}
              width={row.width}
              height={row.height}
              thumbnail={thumbnail}
              variants={row.variants}
              status={row.status}
              encodeProgress={row.encodeProgress}
              aspectRatio={16 / 9}
              className="[&_img]:object-cover [&_video]:object-cover"
              onPlayThreshold={() => void api.clips.recordView(row.id)}
              onEnded={handleEnded}
              autoPlay
              autoAdvance={canNav ? autoAdvance : undefined}
              onAutoAdvanceChange={onAutoAdvanceChange}
            />
          </div>

          {/* ---- Next clip chevron (below video) ---- */}
          <div className="relative z-10 flex shrink-0 justify-center py-1">
            {canNav && next ? (
              <button
                type="button"
                onClick={() => onNavigate!(next)}
                className="text-white/50 drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] active:text-white/80"
                aria-label="Next clip"
              >
                <ChevronDownIcon className="size-7 stroke-[2.5]" />
              </button>
            ) : (
              <div className="size-7" />
            )}
          </div>

          {/* ---- Bottom section ---- */}
          <div className="relative z-10 flex flex-1 overflow-hidden">
            {/* Left: metadata cluster */}
            <div className="flex flex-1 flex-col justify-end gap-2.5 p-4 pr-2 pb-5">
              {/* Game badge */}
              {gameRef ? (
                <Link
                  to="/g/$slug"
                  params={{ slug: gameRef.slug }}
                  className="inline-flex w-fit items-center gap-2"
                >
                  <GameIcon
                    src={gameIcon}
                    name={gameLabel}
                    className="size-6 rounded"
                  />
                  <span className="text-base font-semibold text-white/90">
                    {gameLabel}
                  </span>
                </Link>
              ) : (
                <span className="text-base font-semibold text-white/90">
                  {gameLabel}
                </span>
              )}

              {/* Author with avatar */}
              <Link
                to="/u/$username"
                params={{ username: handle }}
                className="inline-flex w-fit items-center gap-2"
              >
                <Avatar size="lg" style={avatarStyle} className="rounded-full">
                  {avatarSrc ? (
                    <AvatarImage src={avatarSrc} alt={author} />
                  ) : null}
                  <AvatarFallback style={avatarStyle}>
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="text-lg font-bold text-white">@{handle}</span>
              </Link>

              {/* Title */}
              <h2 className="line-clamp-2 text-[15px] leading-snug font-bold text-white">
                {row.title}
              </h2>

              {/* Mentions */}
              <ClipMentionsRow mentions={row.mentions ?? []} />

              {/* Description */}
              {row.description ? (
                <p className="line-clamp-3 text-sm leading-relaxed whitespace-pre-wrap text-white/65">
                  {renderDescriptionTokens(row.description, {
                    linkHashtags: true,
                  })}
                </p>
              ) : null}
            </div>

            {/* Right: action buttons */}
            <div className="flex flex-col items-center justify-end gap-5 px-3 pb-5">
              {/* Like */}
              <button
                type="button"
                onClick={handleLike}
                disabled={!canLike}
                className="flex flex-col items-center gap-0.5 disabled:opacity-50"
              >
                <HeartIcon
                  className={cn(
                    "size-7",
                    liked ? "fill-red-500 text-red-500" : "text-white"
                  )}
                />
                <span className="text-xs font-semibold text-white tabular-nums">
                  {formatCount(row.likeCount)}
                </span>
              </button>

              {/* Comments */}
              <button
                type="button"
                onClick={() => setCommentsOpen(true)}
                className="flex flex-col items-center gap-0.5"
              >
                <MessageSquareIcon className="size-7 text-white" />
                <span className="text-xs font-semibold text-white tabular-nums">
                  {formatCount(row.commentCount)}
                </span>
              </button>

              {/* Share */}
              <button
                type="button"
                onClick={handleShare}
                className="flex flex-col items-center"
              >
                <Share2Icon className="size-7 text-white" />
              </button>

              {/* Owner/Admin menu */}
              {canManage ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        className="flex flex-col items-center text-white/80"
                        aria-label="Clip actions"
                      >
                        <MoreHorizontalIcon className="size-7 rotate-90" />
                      </button>
                    }
                  />
                  <DropdownMenuContent align="end" className="min-w-[150px]">
                    <DropdownMenuItem onClick={() => setEditOpen(true)}>
                      <PencilIcon /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={deleting}
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      <Trash2Icon /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </div>

          {/* ---- Comments drawer (bottom sheet) ---- */}
          <Drawer
            open={commentsOpen}
            onOpenChange={setCommentsOpen}
            direction="bottom"
          >
            <DrawerContent className="max-h-[85vh] bg-surface">
              <DrawerTitle className="sr-only">Comments</DrawerTitle>
              <ClipComments
                clipId={row.id}
                clipAuthorId={row.authorId}
                className="min-h-0 flex-1 overflow-y-auto border-0"
              />
            </DrawerContent>
          </Drawer>
        </div>
      </DialogViewportContent>

      <ClipEditDialog open={editOpen} onOpenChange={setEditOpen} row={row} />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this clip?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete clip"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export { MobileClipViewerBody, type MobileClipViewerBodyProps }
