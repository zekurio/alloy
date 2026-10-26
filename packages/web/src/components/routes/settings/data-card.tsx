import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { DownloadIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { StorageQuota } from "@/components/storage-quota"
import { api } from "@/lib/api"
import { startBrowserDownload } from "@/lib/browser-download"
import { errorMessage } from "@/lib/error-message"

async function deleteAllClips() {
  let hasMore = true
  while (hasMore) {
    const result = await api.users.deleteAllClips()
    if (result.deleted === 0) break
    hasMore = result.hasMore
  }
}

function DownloadClipsRow() {
  const [failed, setFailed] = useState(false)

  function onDownloadAllClips() {
    const started = startBrowserDownload(api.users.downloadAllClipsUrl(), {
      rel: "noopener",
    })
    setFailed(!started)
  }

  return (
    <SettingRow
      title={t("Download clips")}
      description={t(
        "Download a zip archive with the original files for your clips.",
      )}
    >
      <FeedbackButton
        type="button"
        variant="secondary"
        size="sm"
        state={failed ? "error" : "idle"}
        errorLabel={t("Try again")}
        onClick={onDownloadAllClips}
      >
        <DownloadIcon />
        {t("Download")}
      </FeedbackButton>
    </SettingRow>
  )
}

function DeleteClipsRow() {
  const queryClient = useQueryClient()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const remove = useMutation({
    mutationFn: deleteAllClips,
    onSuccess: () => setDeleteOpen(false),
    // Batches that finished before a failure are gone too, so every clip
    // cache is stale either way.
    onSettled: () => queryClient.invalidateQueries(),
  })

  return (
    <SettingRow
      title={t("Delete clips")}
      description={t(
        "Permanently removes every clip you uploaded. This can't be undone.",
      )}
    >
      <>
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2Icon />
          {t("Delete clips")}
        </Button>
        <ConfirmDeleteDialog
          open={deleteOpen}
          onOpenChange={(open) => {
            setDeleteOpen(open)
            if (!open) remove.reset()
          }}
          title={t("Delete all clips?")}
          description={t("This permanently removes every clip you uploaded.")}
          confirmLabel={t("Delete clips")}
          pendingLabel={t("Deleting...")}
          pending={remove.isPending}
          error={
            remove.error
              ? errorMessage(remove.error, t("Couldn't delete clips"))
              : null
          }
          onConfirm={() => remove.mutate()}
        />
      </>
    </SettingRow>
  )
}

export function StorageUsageCard() {
  return <StorageQuota className="py-0" />
}

export function ClipDataCard() {
  return (
    <SettingRows>
      <DownloadClipsRow />
      <DeleteClipsRow />
    </SettingRows>
  )
}
