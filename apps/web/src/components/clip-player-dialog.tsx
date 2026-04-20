import * as React from "react"

import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { ClipCard } from "@workspace/ui/components/clip-card"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import {
  type ClipEncodedVariant,
  type ClipGameRef,
  type ClipPrivacy,
} from "../lib/clips-api"

const ClipPlayerDialogContent = React.lazy(() =>
  import("./clip-player-dialog-content").then((m) => ({
    default: m.ClipPlayerDialogContent,
  }))
)

/**
 * Clickable `ClipCard` that pops open a focused player overlay.
 *
 * Kept as a single component so the call-site API stays identical to the
 * underlying `ClipCard`: pass the same presentational props the grid
 * already has (title, author, game, etc.) plus the hand-off fields the
 * dialog needs to actually play the clip (`clipId`, `streamUrl`,
 * `authorHandle`). Hover-to-play on the card happens via `streamUrl`
 * being forwarded down to `ClipCard`.
 */
export interface ClipCardTriggerProps {
  /** Row id — drives the dialog's `<video src>` through `ClipPlayer`. */
  clipId: string
  /** Precomputed stream URL. Kept separate so the card can play it on hover. */
  streamUrl: string
  /** Optional poster. Omit to let `ClipPlayer` point at the thumbnail endpoint. */
  thumbnail?: string
  /** Encoded playback ladder available for quality switching/downloads. */
  variants: ClipEncodedVariant[]
  /** Uploader's handle — links to `/u/:handle` on the avatar and name. */
  authorHandle: string
  /**
   * Uploader's stable user id. Threaded through so the meta row can
   * compare against the viewer's session and surface owner-only
   * affordances (edit / delete) in the action dropdown. Separate from
   * `authorHandle` because the handle is a display string that can be
   * renamed; the id can't.
   */
  authorId: string
  /** Display name shown on the card + meta row. */
  author: string
  /** Uploader avatar URL (from `user.image`); null when not uploaded yet. */
  authorImage?: string | null
  title: string
  game: string
  /**
   * Mapped SGDB game row for the clip, or `null` when the uploader
   * didn't pick one / the row is a legacy text-only entry. Threaded into
   * `ClipMeta` so the owner's game editor can seed its combobox with
   * the current pick. Non-owners never see the editor, so the null case
   * is just a no-op.
   */
  gameRef: ClipGameRef | null
  /**
   * Pre-built href for the game badge on the card. Kept as a plain
   * string so `@workspace/ui`'s `ClipCard` doesn't need to know about
   * the app's router; the caller (route component) resolves the slug
   * into `/g/:slug` before handing it down. `null` when the clip isn't
   * mapped to an SGDB game — the card then renders the label as a
   * plain span.
   */
  gameHref: string | null
  views: string
  likes: string
  comments: string
  postedAt: string
  accentHue: number
  /**
   * Gate for the card's lock/link badge. Only set by callers that have
   * verified the viewer owns the clip — the card uses its presence as
   * the gate so non-owners don't see an "Unlisted" marker on clips they
   * reached via the feed. Separate from `clipPrivacy` on purpose: this
   * prop drives a visibility policy, `clipPrivacy` is the real value.
   */
  privacy?: ClipPrivacy
  /**
   * Stored privacy, always the real value. Threaded into `ClipMeta` so
   * the owner's inline edit form can seed its dirty state. Unlike
   * `privacy`, this is never hidden from non-owners — `ClipMeta` itself
   * gates the privacy pill + picker on owner-ness.
   */
  clipPrivacy: ClipPrivacy
  /**
   * Author-supplied description, already threaded from the feed payload
   * so the dialog doesn't need a second fetch. Rendered by `ClipMeta`
   * below the action bar.
   */
  description: string | null
  className?: string
}

export function ClipCardTrigger({
  className,
  clipId,
  streamUrl,
  thumbnail,
  variants,
  authorHandle,
  authorId,
  author,
  authorImage,
  title,
  game,
  gameRef,
  gameHref,
  views,
  likes,
  comments,
  postedAt,
  accentHue,
  privacy,
  clipPrivacy,
  description,
}: ClipCardTriggerProps) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  // Base UI restores focus to the trigger on close. For pointer-driven
  // opens that lights up `:focus-visible` and wraps the whole card in a
  // ring — the "silly border" after closing the player. Drop focus on
  // close so only genuine keyboard nav leaves the ring behind.
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      // Defer past Base UI's own focus restore.
      requestAnimationFrame(() => triggerRef.current?.blur())
    }
  }
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <button
            ref={triggerRef}
            type="button"
            className={cn(
              "block cursor-pointer rounded-md text-left",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
              className
            )}
          />
        }
      >
        <ClipCard
          title={title}
          author={author}
          authorImage={authorImage}
          game={game}
          gameHref={gameHref}
          views={views}
          likes={likes}
          comments={comments}
          postedAt={postedAt}
          thumbnail={thumbnail}
          accentHue={accentHue}
          streamUrl={streamUrl}
          privacy={privacy}
        />
      </DialogTrigger>

      {open ? (
        <React.Suspense fallback={<ClipPlayerDialogFallback />}>
          <ClipPlayerDialogContent
            clipId={clipId}
            thumbnail={thumbnail}
            variants={variants}
            authorHandle={authorHandle}
            authorId={authorId}
            author={author}
            authorImage={authorImage}
            title={title}
            game={game}
            gameRef={gameRef}
            views={views}
            likes={likes}
            comments={comments}
            postedAt={postedAt}
            accentHue={accentHue}
            clipPrivacy={clipPrivacy}
            description={description}
          />
        </React.Suspense>
      ) : null}
    </Dialog>
  )
}

function ClipPlayerDialogFallback() {
  return (
    <DialogContent
      className={cn(
        "h-[96vh] max-h-[1200px] w-[95vw] max-w-[1480px] max-w-none",
        "grid place-items-center overflow-hidden p-0"
      )}
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface">
        <Spinner className="size-5" />
        <span className="font-mono text-2xs tracking-[0.08em] text-foreground-faint uppercase">
          Loading clip
        </span>
      </div>
    </DialogContent>
  )
}
