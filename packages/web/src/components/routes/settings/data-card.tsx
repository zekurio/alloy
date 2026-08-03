import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { DownloadIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"

import { StorageQuota } from "@/components/storage-quota"
import { api } from "@/lib/api"
import { startBrowserDownload } from "@/lib/browser-download"
import { errorMessage } from "@/lib/error-message"
import { getQueryClient } from "@/lib/query-client"

function useDeleteAllClipsAction() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onDeleteAllClips = async () => {
    if (pending) return false
    setError(null)
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
      return true
    } catch (cause) {
      setError(errorMessage(cause, t("Couldn't delete clips")))
      return false
    } finally {
      setPending(false)
    }
  }

  return { pending, error, setError, onDeleteAllClips }
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
        variant="outline"
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

function DeleteClipsRow({
  pending,
  error,
  clearError,
  onDeleteAllClips,
}: {
  pending: boolean
  error: string | null
  clearError: () => void
  onDeleteAllClips: () => Promise<boolean>
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)

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
            if (!open) clearError()
          }}
          title={t("Delete all clips?")}
          description={t("This permanently removes every clip you uploaded.")}
          confirmLabel={t("Delete clips")}
          pendingLabel={t("Deleting...")}
          pending={pending}
          error={error}
          onConfirm={() => {
            void onDeleteAllClips().then((deleted) => {
              if (deleted) setDeleteOpen(false)
            })
          }}
        />
      </>
    </SettingRow>
  )
}

export function StorageUsageCard() {
  return <StorageQuota className="py-0" />
}

export function ClipDataCard() {
  const { pending, error, setError, onDeleteAllClips } =
    useDeleteAllClipsAction()

  return (
    <SettingRows>
      <DownloadClipsRow />
      <DeleteClipsRow
        pending={pending}
        error={error}
        clearError={() => setError(null)}
        onDeleteAllClips={onDeleteAllClips}
      />
    </SettingRows>
  )
}
