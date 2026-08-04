import { t } from "@alloy/i18n"
import { AppMain } from "@alloy/ui/components/app-shell"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { useNavigate } from "@tanstack/react-router"
import { FileQuestionIcon, FolderXIcon, MonitorIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { EmptyState } from "@/components/feedback/empty-state"
import {
  alloyDesktop,
  type AlloyDesktop,
  notifyLibraryCapturesChanged,
} from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"

import { EditorBody } from "./library-editor-body"
import { BackToLibraryButton } from "./library-editor-shared"
import {
  useLibraryEntryNavigation,
  useNavigateToLibraryEntry,
} from "./library-entry-navigation"

export function LibraryEditorPage({
  captureId,
  promptGame = false,
}: {
  captureId: string
  promptGame?: boolean
}) {
  const desktop = alloyDesktop()

  if (!desktop) {
    return (
      <AppMain>
        <EmptyState
          icon={MonitorIcon}
          size="lg"
          fill
          title={t("The library is only available in Alloy Desktop")}
          hint={t(
            "Open Alloy in the desktop app to edit captures stored on this device.",
          )}
        />
      </AppMain>
    )
  }

  return (
    <LibraryEditorContent
      desktop={desktop}
      captureId={captureId}
      promptGame={promptGame}
    />
  )
}

function LibraryEditorContent({
  desktop,
  captureId,
  promptGame,
}: {
  desktop: AlloyDesktop
  captureId: string
  promptGame: boolean
}) {
  const navigate = useNavigate()
  const navigateToEntry = useNavigateToLibraryEntry()
  const navigation = useLibraryEntryNavigation({ type: "local", id: captureId })
  const { snapshot, error, refreshing, prevEntry, nextEntry } = navigation
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const currentEntry = navigation.currentEntry
  const item = useMemo(() => {
    return currentEntry?.type === "local" ? currentEntry.item : null
  }, [currentEntry])

  useEffect(() => {
    if (currentEntry && currentEntry.type !== "local") {
      navigateToEntry(currentEntry)
    }
  }, [currentEntry, navigateToEntry])

  const deleteCapture = async () => {
    if (deleting || !item) return
    setDeleteError(null)
    setDeleting(true)
    const fallback = nextEntry ?? prevEntry
    try {
      await desktop.recording.deleteLibraryCapture(item.id)
      // The next entry may be a cloud clip linked to a local capture. Remove
      // this path synchronously so it cannot be selected while the re-scan is
      // still in flight and fail playback with MEDIA_ERR_SRC_NOT_SUPPORTED.
      notifyLibraryCapturesChanged(item.id)
      setDeleteDialogOpen(false)
      setDeleting(false)
      if (fallback) {
        navigateToEntry(fallback)
      } else {
        void navigate({ to: "/library", replace: true })
      }
    } catch (cause) {
      setDeleteError(errorMessage(cause, t("Couldn't delete capture")))
      setDeleting(false)
    }
  }

  if (error) {
    return (
      <AppMain>
        <EmptyState
          icon={FolderXIcon}
          size="lg"
          fill
          title={t("Couldn't scan the library")}
          hint={error}
          action={<BackToLibraryButton />}
        />
      </AppMain>
    )
  }

  if (!snapshot) {
    return (
      <AppMain>
        <LoadingState className="py-16" />
      </AppMain>
    )
  }

  if (currentEntry && currentEntry.type !== "local") {
    return (
      <AppMain>
        <LoadingState className="py-16" />
      </AppMain>
    )
  }

  if (!item && refreshing) {
    return (
      <AppMain>
        <LoadingState className="py-16" />
      </AppMain>
    )
  }

  if (!item) {
    return (
      <AppMain>
        <EmptyState
          icon={FileQuestionIcon}
          size="lg"
          fill
          title={t("Capture not found")}
          hint={t("It may have been moved or deleted from the capture folder.")}
          action={<BackToLibraryButton />}
        />
      </AppMain>
    )
  }

  return (
    <AppMain className="p-4 md:p-6">
      <EditorBody
        key={item.id}
        desktop={desktop}
        item={item}
        promptGame={promptGame}
        prevEntry={prevEntry}
        nextEntry={nextEntry}
        deleting={deleting}
        onRequestDelete={() => setDeleteDialogOpen(true)}
      />
      <DeleteLocalCaptureDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open) setDeleteError(null)
        }}
        pending={deleting}
        error={deleteError}
        onConfirm={() => {
          void deleteCapture()
        }}
      />
    </AppMain>
  )
}

function DeleteLocalCaptureDialog({
  open,
  onOpenChange,
  pending,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  error: string | null
  onConfirm: () => void
}) {
  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Delete this capture?")}
      description={t("The file will be moved to your system trash.")}
      confirmLabel={t("Delete capture")}
      pendingLabel={t("Deleting...")}
      pending={pending}
      error={error}
      onConfirm={onConfirm}
    />
  )
}
