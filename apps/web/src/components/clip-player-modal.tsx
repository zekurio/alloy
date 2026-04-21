import * as React from "react"

import { Dialog, DialogContent } from "@workspace/ui/components/dialog"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import { useClipQuery } from "../lib/clip-queries"

import { ClipPlayerDialogContent } from "./clip-player-dialog-content"

interface ClipPlayerModalProps {
  /** Current modal target. `null` keeps the modal closed. */
  clipId: string | null
  /** How to dismiss — typically clears the search param or navigates back. */
  onClose: () => void
}

export function ClipPlayerModal({ clipId, onClose }: ClipPlayerModalProps) {
  const open = clipId !== null
  const query = useClipQuery(clipId ?? "")

  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (event.defaultPrevented) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      {open ? (
        query.data ? (
          <ClipPlayerDialogContent row={query.data} onDeleted={onClose} />
        ) : (
          <ClipPlayerModalFallback />
        )
      ) : null}
    </Dialog>
  )
}

function ClipPlayerModalFallback() {
  return (
    <DialogContent
      className={cn(
        "h-[96vh] max-w-none",
        "grid place-items-center overflow-hidden p-0"
      )}
      style={{ width: `min(97vw, calc(70vh * ${16 / 9} + 480px))` }}
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface">
        <Spinner className="size-5" />
        <span className="text-xs text-foreground-faint uppercase tracking-wide">
          Loading clip
        </span>
      </div>
    </DialogContent>
  )
}

