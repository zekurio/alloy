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
} from "alloy-ui/components/alert-dialog"
import { Button } from "alloy-ui/components/button"
import { Section, SectionContent } from "alloy-ui/components/section"
import { toast } from "alloy-ui/lib/toast"
import { DownloadIcon, Trash2Icon } from "lucide-react"
import * as React from "react"

import { StorageQuota } from "@/components/storage-quota"
import { api } from "@/lib/api"
import { startBrowserDownload } from "@/lib/browser-download"
import { errorMessage } from "@/lib/error-message"
import { getQueryClient } from "@/lib/query-client"

function DataActionRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <p className="text-foreground-dim mt-0.5 text-xs">{description}</p>
      </div>
      {children}
    </div>
  )
}

function useDeleteAllClipsAction() {
  const [pending, setPending] = React.useState(false)

  const onDeleteAllClips = async () => {
    if (pending) return
    setPending(true)
    try {
      let deleted = 0
      let hasMore = true
      while (hasMore) {
        const result = await api.users.deleteAllClips()
        deleted += result.deleted
        hasMore = result.hasMore
        if (result.deleted === 0) break
      }
      await getQueryClient().invalidateQueries()
      toast.success(
        deleted === 1 ? "Deleted 1 clip" : `Deleted ${deleted} clips`,
      )
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't delete clips"))
    } finally {
      setPending(false)
    }
  }

  return { pending, onDeleteAllClips }
}

function DownloadClipsRow() {
  function onDownloadAllClips() {
    const started = startBrowserDownload(api.users.downloadAllClipsUrl(), {
      rel: "noopener",
    })
    if (!started) toast.error("Couldn't start download")
  }

  return (
    <DataActionRow
      title="Download clips"
      description="Download a zip archive with the original files for your clips."
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onDownloadAllClips}
      >
        <DownloadIcon />
        Download
      </Button>
    </DataActionRow>
  )
}

function DeleteClipsRow({
  pending,
  onDeleteAllClips,
}: {
  pending: boolean
  onDeleteAllClips: () => Promise<void>
}) {
  return (
    <DataActionRow
      title="Delete clips"
      description="Permanently removes every clip you uploaded. This can't be undone."
    >
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button type="button" variant="danger" size="sm">
              <Trash2Icon />
              Delete clips
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all clips?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes every clip you uploaded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={onDeleteAllClips}
              disabled={pending}
            >
              {pending ? "Deleting..." : "Delete clips"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DataActionRow>
  )
}

export function StorageUsageCard() {
  return (
    <Section>
      <SectionContent className="py-0">
        <StorageQuota />
      </SectionContent>
    </Section>
  )
}

export function ClipDataCard() {
  const { pending, onDeleteAllClips } = useDeleteAllClipsAction()

  return (
    <Section>
      <SectionContent className="divide-border divide-y py-0">
        <DownloadClipsRow />
        <DeleteClipsRow pending={pending} onDeleteAllClips={onDeleteAllClips} />
      </SectionContent>
    </Section>
  )
}
