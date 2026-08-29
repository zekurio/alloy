import type { ClipRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Chip } from "@alloy/ui/components/chip"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import {
  ChevronDownIcon,
  CloudIcon,
  FolderOpenIcon,
  MonitorIcon,
  Trash2Icon,
} from "lucide-react"
import { useState } from "react"
import type { ReactNode } from "react"

import {
  ClipBrowserDownloadMenuItem,
  ClipDownloadMenuItem,
} from "@/components/clip/clip-download-button"
import { ClipMetadataSection } from "@/components/clip/clip-metadata-editor"
import { clientLogger } from "@/lib/client-log"
import { alloyDesktop, type RecordingLibraryItem } from "@/lib/desktop"
import { formatBytes } from "@/lib/storage-format"

import { deleteLocalLibraryCopy } from "./library-local-actions"

type LocationDeleteAction = {
  disabled: boolean
  label: string
  pending: boolean
  pendingLabel: string
  onSelect: () => void
}

export function LocalFileLocation({
  item,
  deleting,
  onRequestDelete,
}: {
  item: RecordingLibraryItem
  deleting: boolean
  onRequestDelete: () => void
}) {
  return (
    <ClipMetadataSection label={t("File Location")}>
      <LocationMenu
        label={t("On Device")}
        icon={<MonitorIcon />}
        sizeBytes={item.sizeBytes}
        localItem={item}
        allowRemoveLocal={false}
        deleteAction={{
          disabled: deleting,
          label: t("Delete capture"),
          pending: deleting,
          pendingLabel: t("Deleting..."),
          onSelect: onRequestDelete,
        }}
      />
    </ClipMetadataSection>
  )
}

export function ClipFileLocation({
  row,
  localItem,
  deleteAction = null,
}: {
  row: ClipRow
  localItem: RecordingLibraryItem | null
  deleteAction?: LocationDeleteAction | null
}) {
  const desktop = alloyDesktop()
  const downloadAction = desktop ? (
    localItem ? null : (
      <ClipDownloadMenuItem row={row} />
    )
  ) : (
    <ClipBrowserDownloadMenuItem row={row} />
  )

  return (
    <ClipMetadataSection label={t("File Location")}>
      <LocationMenu
        label={localItem ? t("Server + Device") : t("On Server")}
        icon={localItem ? <MonitorIcon /> : <CloudIcon />}
        sizeBytes={row.sourceSizeBytes}
        localItem={localItem}
        allowRemoveLocal
        downloadAction={downloadAction}
        deleteAction={deleteAction}
      />
    </ClipMetadataSection>
  )
}

function LocationMenu({
  label,
  icon,
  sizeBytes,
  localItem,
  allowRemoveLocal = true,
  downloadAction = null,
  deleteAction = null,
}: {
  label: string
  icon: ReactNode
  sizeBytes: number | null
  localItem: RecordingLibraryItem | null
  allowRemoveLocal?: boolean
  downloadAction?: ReactNode
  deleteAction?: LocationDeleteAction | null
}) {
  const [removingLocal, setRemovingLocal] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const hasSize = sizeBytes !== null && sizeBytes !== undefined && sizeBytes > 0

  const revealLocal = () => {
    if (!localItem) return
    void alloyDesktop()?.recording.revealLibraryCapture(localItem.id)
  }

  const removeLocal = async () => {
    if (!localItem || removingLocal) return
    setRemoveError(null)
    setRemovingLocal(true)
    try {
      await deleteLocalLibraryCopy(localItem)
      setRemoveDialogOpen(false)
    } catch (cause) {
      clientLogger.warn("[library] Failed to remove local clip copy.", cause)
      setRemoveError(t("Couldn't remove the local copy"))
    } finally {
      setRemovingLocal(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Chip size="xl" className="max-w-full justify-start" />}
        >
          {icon}
          <span className="min-w-0 truncate">{label}</span>
          {hasSize ? (
            <span className="text-foreground-faint font-normal">
              {"("}
              {formatBytes(sizeBytes)}
              {")"}
            </span>
          ) : null}
          <ChevronDownIcon className="text-foreground-faint" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          {localItem ? (
            <>
              <DropdownMenuItem onClick={revealLocal}>
                <FolderOpenIcon />
                {t("Reveal in folder")}
              </DropdownMenuItem>
              {allowRemoveLocal ? (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={removingLocal}
                  onClick={() => setRemoveDialogOpen(true)}
                >
                  <Trash2Icon />
                  {removingLocal ? t("Removing...") : t("Remove local copy")}
                </DropdownMenuItem>
              ) : null}
            </>
          ) : downloadAction ? (
            downloadAction
          ) : (
            <DropdownMenuItem disabled>
              <CloudIcon />
              {t("Server only")}
            </DropdownMenuItem>
          )}
          {localItem && downloadAction ? (
            <>
              <DropdownMenuSeparator />
              {downloadAction}
            </>
          ) : null}
          {deleteAction ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={deleteAction.disabled}
                onClick={deleteAction.onSelect}
              >
                <Trash2Icon />
                {deleteAction.pending
                  ? deleteAction.pendingLabel
                  : deleteAction.label}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDeleteDialog
        open={removeDialogOpen}
        onOpenChange={(open) => {
          setRemoveDialogOpen(open)
          if (!open) setRemoveError(null)
        }}
        title={t("Remove the local copy?")}
        description={t(
          "The file will be moved to your system trash. The server clip will remain available.",
        )}
        confirmLabel={t("Remove local copy")}
        pendingLabel={t("Removing...")}
        pending={removingLocal}
        error={removeError}
        onConfirm={() => void removeLocal()}
      />
    </div>
  )
}
