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
import { toast } from "@workspace/ui/components/sonner"

import { api } from "@/lib/api"
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
        <p className="mt-0.5 text-xs text-foreground-dim">{description}</p>
      </div>
      {children}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

function StorageQuotaRow() {
  const { data } = useQuery({
    queryKey: ["user", "storage"],
    queryFn: () => api.users.fetchStorageUsage(),
    staleTime: 30_000,
  })

  const usedBytes = data?.usedBytes ?? 0
  const quotaBytes = data?.quotaBytes ?? null
  const pct =
    quotaBytes && quotaBytes > 0
      ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100))
      : 0

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
      {quotaBytes === null ? null : <Progress value={pct} />}
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
      const result = await api.users.deleteAllClips()
      await getQueryClient().invalidateQueries()
      toast.success(
        result.deleted === 1
          ? "Deleted 1 clip"
          : `Deleted ${result.deleted} clips`
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
