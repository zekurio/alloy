import { type ClipRow, clipThumbnailUrl } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogViewportContent,
} from "@alloy/ui/components/dialog"
import { Spinner } from "@alloy/ui/components/spinner"
import { useMediaQuery } from "@alloy/ui/hooks/use-media-query"
import { useWindowEvent } from "@alloy/ui/hooks/use-window-event"
import { cssVariables } from "@alloy/ui/lib/css-properties"
import { cn } from "@alloy/ui/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef } from "react"

import { DeleteServerBackedDialog } from "@/components/routes/library/library-delete-dialog"
import {
  clipDetailQueryOptions,
  seedClipDetailInCache,
  useClipQuery,
} from "@/lib/clip-queries"
import { recordClipViewBestEffort } from "@/lib/clip-view-tracking"
import { apiOrigin } from "@/lib/env"

import { ClipDetailsPanel } from "./clip-details-panel"
import {
  type ClipListEntry,
  setActiveClipList,
  useActiveClipList,
} from "./clip-list-context"
import { ClipPlayer } from "./clip-player"
import { MobileClipViewerBody } from "./clip-viewer-mobile"
import { useClipRetry } from "./use-clip-retry"
import { useClipViewerDelete } from "./use-clip-viewer-delete"

interface ClipViewerDialogProps {
  /** Current dialog target. `null` keeps the viewer open. */
  clipId: string | null
  /** How to dismiss — typically clears the search param or navigates back. */
  onClose: () => void
  onNavigate?: (entry: ClipListEntry) => void
}

export function ClipViewerDialog({
  clipId,
  onClose,
  onNavigate,
}: ClipViewerDialogProps) {
  const queryClient = useQueryClient()
  // Use lg breakpoint (1024px) so the mobile player covers the range where
  // the desktop grid/sidebar layout hasn't kicked in yet.
  const isDesktop = useMediaQuery("(min-width: 1024px)")
  const open = clipId !== null
  const query = useClipQuery(clipId ?? "")
  const list = useActiveClipList()

  const closeViewer = useCallback(() => {
    setActiveClipList(null)
    onClose()
  }, [onClose])

  const prev = useMemo(() => {
    if (!list || !clipId) return null
    return list.prevOf(clipId)
  }, [list, clipId])
  const next = useMemo(() => {
    if (!list || !clipId) return null
    return list.nextOf(clipId)
  }, [list, clipId])

  const navigateTo = useCallback(
    (entry: ClipListEntry) => {
      if (!onNavigate) return
      seedClipDetail(queryClient, entry)
      onNavigate(entry)
    },
    [onNavigate, queryClient],
  )

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (isEditableKeyTarget(event.target)) return
      if (event.key === "ArrowLeft" && prev) {
        event.preventDefault()
        navigateTo(prev)
      } else if (event.key === "ArrowRight" && next) {
        event.preventDefault()
        navigateTo(next)
      }
    },
    [prev, next, navigateTo],
  )
  useWindowEvent("keydown", onKey, true, open)

  useEffect(() => {
    if (!open) return
    const neighbours = [prev, next].filter((entry): entry is ClipListEntry =>
      Boolean(entry),
    )
    for (const entry of neighbours) {
      seedClipDetail(queryClient, entry)
      void queryClient.prefetchQuery(clipDetailQueryOptions(entry.id))
    }
  }, [open, prev, next, queryClient])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeViewer()
      }}
    >
      {open ? (
        query.data ? (
          !isDesktop ? (
            <MobileClipViewerBody
              row={query.data}
              onDeleted={closeViewer}
              prev={prev}
              next={next}
              onNavigate={onNavigate ? navigateTo : null}
            />
          ) : (
            <ClipViewerDialogBody
              row={query.data}
              onDeleted={closeViewer}
              prev={prev}
              next={next}
              onNavigate={onNavigate ? navigateTo : null}
            />
          )
        ) : (
          <ClipViewerDialogFallback />
        )
      ) : null}
    </Dialog>
  )
}

function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "BUTTON" ||
    tag === "A"
  )
}

function seedClipDetail(
  queryClient: ReturnType<typeof useQueryClient>,
  entry: ClipListEntry,
) {
  const row = entry.row
  if (!row) return
  seedClipDetailInCache(queryClient, row)
}

interface ClipViewerDialogBodyProps {
  row: ClipRow
  /** Fires after the clip is deleted — used to dismiss the dialog. */
  onDeleted?: () => void
  prev?: ClipListEntry | null
  next?: ClipListEntry | null
  onNavigate?: ((entry: ClipListEntry) => void) | null
}

function ClipViewerDialogBody({
  row,
  onDeleted,
  prev,
  next,
  onNavigate,
}: ClipViewerDialogBodyProps) {
  const thumbnail = row.thumbKey
    ? clipThumbnailUrl(row.id, apiOrigin(), row.thumbVersion ?? undefined)
    : null
  const initialFocusRef = useRef<HTMLDivElement>(null)
  const deleteFlow = useClipViewerDelete({ row, onDeleted })
  const retry = useClipRetry(row)

  const aspectRatio =
    row.mediaKind === "image" && row.width && row.height
      ? row.width / row.height
      : 16 / 9

  const canNavigate = Boolean(onNavigate)
  const showPrev = canNavigate
  const showNext = canNavigate
  const prevDisabled = !prev
  const nextDisabled = !next

  return (
    <DialogViewportContent
      initialFocus={initialFocusRef}
      style={cssVariables({
        "--clip-modal-margin-x": "24px",
        "--clip-modal-margin-y": "24px",
        "--clip-modal-nav-gutter": "56px",
        "--clip-modal-sidebar": "360px",
        "--clip-modal-ratio": aspectRatio,
        "--clip-modal-media-height":
          "min(calc(100dvh - var(--clip-modal-margin-y)*2), calc((100dvw - var(--clip-modal-margin-x)*2 - var(--clip-modal-nav-gutter)*2 - var(--clip-modal-sidebar))/var(--clip-modal-ratio)))",
      })}
      className={cn(
        // Below lg this branch is normally hidden by MobileClipViewerBody, but
        // we keep a sensible fallback in case the breakpoint check disagrees.
        "h-auto max-h-[calc(100dvh-32px)] w-[calc(100dvw-32px)] overflow-visible rounded-xl bg-surface transition-[filter,opacity,transform] duration-100",
        "lg:h-[calc(min(calc(100dvh-var(--clip-modal-margin-y)*2),calc((100dvw-var(--clip-modal-margin-x)*2-var(--clip-modal-nav-gutter)*2-var(--clip-modal-sidebar))/var(--clip-modal-ratio))))]",
        "lg:max-h-[calc(100dvh-var(--clip-modal-margin-y)*2)]",
        "lg:min-h-[min(480px,calc(100dvh-var(--clip-modal-margin-y)*2))]",
        "lg:w-[calc(min(calc(100dvw-var(--clip-modal-margin-x)*2-var(--clip-modal-nav-gutter)*2-var(--clip-modal-sidebar)),calc((100dvh-var(--clip-modal-margin-y)*2)*var(--clip-modal-ratio)))+var(--clip-modal-sidebar))]",
        "lg:max-w-[calc(100dvw-var(--clip-modal-margin-x)*2-var(--clip-modal-nav-gutter)*2)]",
        row.mediaKind === "image" &&
          "lg:min-w-[min(840px,calc(100dvw-var(--clip-modal-margin-x)*2-var(--clip-modal-nav-gutter)*2))]",
      )}
    >
      {showPrev ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => (prev && onNavigate ? onNavigate(prev) : undefined)}
          aria-label={t("Previous clip")}
          disabled={prevDisabled}
          className={cn(
            // h/w carry the lg: prefix so they beat the icon-size default
            // (sm:size-8) in the cascade; the buttons only render at lg+.
            "absolute top-1/2 left-[calc(50%-50dvw+24px)] z-40 lg:size-12 -translate-y-1/2 rounded-none border-transparent bg-transparent text-white/70 shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:text-white hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-8 [&_svg]:stroke-[2.5]",
            "disabled:cursor-default disabled:text-white/25 disabled:hover:text-white/25",
            "hidden lg:inline-flex",
          )}
        >
          <ChevronLeftIcon />
        </Button>
      ) : null}
      {showNext ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => (next && onNavigate ? onNavigate(next) : undefined)}
          aria-label={t("Next clip")}
          disabled={nextDisabled}
          className={cn(
            "absolute top-1/2 right-[calc(50%-50dvw+24px)] z-40 lg:size-12 -translate-y-1/2 rounded-none border-transparent bg-transparent text-white/70 shadow-none drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] hover:border-transparent hover:bg-transparent hover:text-white hover:shadow-none hover:drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)] [&_svg]:!size-8 [&_svg]:stroke-[2.5]",
            "disabled:cursor-default disabled:text-white/25 disabled:hover:text-white/25",
            "hidden lg:inline-flex",
          )}
        >
          <ChevronRightIcon />
        </Button>
      ) : null}
      <div
        className={cn(
          "grid h-full min-h-0 overflow-hidden rounded-xl bg-surface",
          "lg:grid-cols-[minmax(0,1fr)_var(--clip-modal-sidebar)]",
        )}
      >
        <div className="flex min-h-0 items-center justify-center overflow-hidden bg-black">
          <div
            ref={initialFocusRef}
            tabIndex={-1}
            className={cn(
              "relative w-full overflow-hidden outline-none",
              row.mediaKind === "image" &&
                "lg:h-(--clip-modal-media-height) lg:aspect-auto",
            )}
            style={{ aspectRatio }}
          >
            <ClipPlayer
              clipId={row.id}
              playbackContentType={row.playbackContentType}
              sourceCodecs={row.sourceCodecs}
              sourceVersion={row.sourceVersion}
              renditions={row.renditions}
              durationMs={row.durationMs}
              trimStartMs={row.trimStartMs}
              trimEndMs={row.trimEndMs}
              thumbnail={thumbnail}
              thumbnailBlurHash={row.thumbBlurHash}
              fallbackSeed={row.gameId ?? row.id}
              status={row.status}
              encodeProgress={row.encodeProgress}
              encodeStage={row.encodeStage}
              encodeTier={row.encodeTier}
              encodeTierIndex={row.encodeTierIndex}
              encodeTierCount={row.encodeTierCount}
              failureReason={row.failureReason}
              canRetry={retry.canRetry}
              onRetry={retry.onRetry}
              retryPending={retry.retryPending}
              aspectRatio={aspectRatio}
              maxDisplayHeight={
                row.mediaKind === "image"
                  ? "var(--clip-modal-media-height)"
                  : "100%"
              }
              className="h-full w-full overflow-hidden rounded-lg shadow-[0_30px_90px_-42px_rgba(0,0,0,0.92)] ring-1 ring-white/10 ring-inset lg:rounded-none lg:shadow-none lg:ring-0"
              onPlayThreshold={() => recordClipViewBestEffort(row.id)}
              autoPlay
              enableHorizontalSeekShortcuts={false}
            />
          </div>
        </div>
        <ClipDetailsPanel
          key={row.id}
          row={row}
          onRequestDelete={deleteFlow.openDialog}
          deletePending={deleteFlow.pending}
          onNavigate={onNavigate}
          closeAction={
            <DialogClose
              render={<Button type="button" variant="ghost" size="icon" />}
              aria-label={t("Close")}
            >
              <XIcon className="size-4" />
            </DialogClose>
          }
        />
      </div>
      <DeleteServerBackedDialog
        open={deleteFlow.open}
        onOpenChange={deleteFlow.setOpen}
        pending={deleteFlow.pending}
        error={deleteFlow.error}
        localItem={deleteFlow.localItem}
        title={row.title}
        noun="clip"
        onConfirm={deleteFlow.confirm}
      />
    </DialogViewportContent>
  )
}

function ClipViewerDialogFallback() {
  return (
    <DialogViewportContent className="grid place-items-center">
      <div className="bg-surface flex h-full w-full flex-col items-center justify-center gap-3">
        <Spinner className="size-5" />
      </div>
    </DialogViewportContent>
  )
}
