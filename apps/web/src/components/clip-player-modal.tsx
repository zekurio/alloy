import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import {
  Dialog,
  DialogViewportContent,
} from "@workspace/ui/components/dialog"
import { Spinner } from "@workspace/ui/components/spinner"

import { fetchClipById } from "../lib/clips-api"
import { clipKeys, useClipQuery } from "../lib/clip-queries"

import {
  setActiveClipList,
  useActiveClipList,
  type ClipListEntry,
} from "./clip-list-context"
import { ClipPlayerDialogContent } from "./clip-player-dialog-content"

interface ClipPlayerModalProps {
  /** Current modal target. `null` keeps the modal closed. */
  clipId: string | null
  /** How to dismiss — typically clears the search param or navigates back. */
  onClose: () => void
  onNavigate?: (entry: ClipListEntry) => void
}

export function ClipPlayerModal({
  clipId,
  onClose,
  onNavigate,
}: ClipPlayerModalProps) {
  const queryClient = useQueryClient()
  const open = clipId !== null
  const query = useClipQuery(clipId ?? "")
  const list = useActiveClipList()

  const prev = React.useMemo(() => {
    if (!list || !clipId) return null
    return list.prevOf(clipId)
  }, [list, clipId])
  const next = React.useMemo(() => {
    if (!list || !clipId) return null
    return list.nextOf(clipId)
  }, [list, clipId])

  const navigateTo = React.useCallback(
    (entry: ClipListEntry) => {
      if (!onNavigate) return
      onNavigate(entry)
    },
    [onNavigate]
  )

  // Clear the active list when the modal closes so stale neighbours
  // don't leak into a later modal open.
  React.useEffect(() => {
    if (!open) setActiveClipList(null)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === "ArrowLeft" && prev) {
        event.preventDefault()
        navigateTo(prev)
      } else if (event.key === "ArrowRight" && next) {
        event.preventDefault()
        navigateTo(next)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, prev, next, navigateTo])

  React.useEffect(() => {
    if (!open) return
    const neighbours = [prev, next].filter((entry): entry is ClipListEntry =>
      Boolean(entry)
    )
    for (const entry of neighbours) {
      void queryClient.prefetchQuery({
        queryKey: clipKeys.detail(entry.id),
        queryFn: () => fetchClipById(entry.id),
      })
    }
  }, [open, prev, next, queryClient])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      {open ? (
        query.data ? (
          <ClipPlayerDialogContent
            row={query.data}
            onDeleted={onClose}
            prev={prev}
            next={next}
            onNavigate={onNavigate ? navigateTo : null}
          />
        ) : (
          <ClipPlayerModalFallback />
        )
      ) : null}
    </Dialog>
  )
}

function ClipPlayerModalFallback() {
  return (
    <DialogViewportContent className="grid place-items-center">
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface">
        <Spinner className="size-5" />
        <span className="text-xs tracking-wide text-foreground-faint uppercase">
          Loading clip
        </span>
      </div>
    </DialogViewportContent>
  )
}
