import { t, tp } from "@alloy/i18n"
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
} from "@alloy/ui/components/alert-dialog"
import { Button } from "@alloy/ui/components/button"
import { Section, SectionContent } from "@alloy/ui/components/section"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { toast } from "@alloy/ui/lib/toast"
import { DownloadIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { StorageQuota } from "@/components/storage-quota"
import { api } from "@/lib/api"
import { startBrowserDownload } from "@/lib/browser-download"
import { errorMessage } from "@/lib/error-message"
import { getQueryClient } from "@/lib/query-client"

function useDeleteAllClipsAction() {
  const [pending, setPending] = useState(false)

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
        tp(deleted, "Deleted {count} clip", "Deleted {count} clips", {
          count: deleted,
        }),
      )
    } catch (cause) {
      toast.error(errorMessage(cause, t("Couldn't delete clips")))
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
    if (!started) toast.error(t("Couldn't start download"))
  }

  return (
    <SettingRow
      className="py-4 first:pt-4 last:pb-4"
      title={t("Download clips")}
      description={t(
        "Download a zip archive with the original files for your clips.",
      )}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onDownloadAllClips}
      >
        <DownloadIcon />
        {t("Download")}
      </Button>
    </SettingRow>
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
    <SettingRow
      className="py-4 first:pt-4 last:pb-4"
      title={t("Delete clips")}
      description={t(
        "Permanently removes every clip you uploaded. This can't be undone.",
      )}
    >
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button type="button" variant="danger" size="sm">
              <Trash2Icon />
              {t("Delete clips")}
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete all clips?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("This permanently removes every clip you uploaded.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={onDeleteAllClips}
              disabled={pending}
            >
              {pending ? t("Deleting...") : t("Delete clips")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingRow>
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
      <SectionContent className="py-0">
        <DownloadClipsRow />
        <DeleteClipsRow pending={pending} onDeleteAllClips={onDeleteAllClips} />
      </SectionContent>
    </Section>
  )
}
