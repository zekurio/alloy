import * as React from "react"
import { DownloadIcon, Trash2Icon } from "lucide-react"
import { useQuery } from "@tanstack/react-query"

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
import { Progress } from "@workspace/ui/components/progress"
import { Section, SectionContent } from "@workspace/ui/components/section"
import { toast } from "@workspace/ui/lib/toast"

import { api } from "@/lib/api"
import { getQueryClient } from "@/lib/query-client"
import { formatBytes, storageUsagePercent } from "@/lib/storage-format"

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
        <p className="mt-0.5 text-xs text-foreground-dim">{description}</p>
      </div>
      {children}
    </div>
  )
}

function StorageQuotaRow() {
  const { data } = useQuery({
    queryKey: ["user", "storage"],
    queryFn: () => api.users.fetchStorageUsage(),
    staleTime: 30_000,
  })

  const usedBytes = data?.usedBytes ?? 0
  const quotaBytes = data?.quotaBytes ?? null
  const pct = storageUsagePercent(usedBytes, quotaBytes)

  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">Storage</div>
          <p className="mt-0.5 text-xs text-foreground-dim">
            Source clips count toward your quota. Encoded copies do not.
          </p>
        </div>
        <div className="shrink-0 text-right text-sm tabular-nums">
          {quotaBytes === null
            ? `${formatBytes(usedBytes)} used`
            : `${formatBytes(usedBytes)} / ${formatBytes(quotaBytes)}`}
        </div>
      </div>
      <Progress value={pct} />
    </div>
  )
}

export function DataCard() {
  const [pending, setPending] = React.useState(false)

  function onDownloadAllClips() {
    window.location.assign(api.users.downloadAllClipsUrl())
  }

  async function onDeleteAllClips() {
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
        deleted === 1 ? "Deleted 1 clip" : `Deleted ${deleted} clips`
      )
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't delete clips"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Section>
      <SectionContent className="divide-y divide-border py-0">
        <StorageQuotaRow />

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

        <DataActionRow
          title="Delete clips"
          description="Permanently removes every clip you uploaded. This can't be undone."
        >
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button type="button" variant="destructive" size="sm">
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
                  {pending ? "Deleting…" : "Delete clips"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DataActionRow>
      </SectionContent>
    </Section>
  )
}
