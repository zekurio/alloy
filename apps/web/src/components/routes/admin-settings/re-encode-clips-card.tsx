import * as React from "react"
import { RefreshCcwIcon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/components/sonner"

import { api } from "@/lib/api"

export function ReEncodeClipsButton() {
  const [pending, setPending] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  async function onConfirm() {
    if (pending) return
    setPending(true)
    try {
      const { enqueued } = await api.admin.reEncodeAllClips()
      if (enqueued === 0) {
        toast.info("No clips to re-encode")
      } else {
        toast.success(
          `Enqueued ${enqueued} ${enqueued === 1 ? "clip" : "clips"} for re-encoding`
        )
      }
      setOpen(false)
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't queue re-encode"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <RefreshCcwIcon />
            Re-encode all
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Re-encode all clips?</AlertDialogTitle>
          <AlertDialogDescription>
            Clips get set back to ready, and variants not in the current ladder
            are deleted from storage when each clip re-encodes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="primary"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "Queuing…" : "Re-encode all"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
