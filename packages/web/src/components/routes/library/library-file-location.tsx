import type { ClipRow } from "@alloy/api"
import { Chip } from "@alloy/ui/components/chip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { toast } from "@alloy/ui/lib/toast"
import {
  ChevronDownIcon,
  CloudIcon,
  FolderOpenIcon,
  MonitorIcon,
  Trash2Icon,
} from "lucide-react"
import * as React from "react"

import { ClipDownloadMenuItem } from "@/components/clip/clip-download-button"
import { ClipMetadataSection } from "@/components/clip/clip-metadata-editor"
import { clientLogger } from "@/lib/client-log"
import { alloyDesktop, type RecordingLibraryItem } from "@/lib/desktop"

import { formatLibraryBytes } from "./library-data"
import { deleteLocalLibraryCopy } from "./library-local-actions"

export function LocalFileLocation({ item }: { item: RecordingLibraryItem }) {
  return (
    <ClipMetadataSection label="File Location">
      <LocationMenu
        label="On Device"
        icon={<MonitorIcon />}
        sizeBytes={item.sizeBytes}
        localItem={item}
        allowRemoveLocal={false}
      />
    </ClipMetadataSection>
  )
}

export function ClipFileLocation({
  row,
  localItem,
}: {
  row: ClipRow
  localItem: RecordingLibraryItem | null
}) {
  return (
    <ClipMetadataSection label="File Location">
      <LocationMenu
        label={localItem ? "Server + Device" : "On Server"}
        icon={localItem ? <MonitorIcon /> : <CloudIcon />}
        sizeBytes={row.sourceSizeBytes}
        localItem={localItem}
        allowRemoveLocal
        download={<ClipDownloadMenuItem row={row} alreadyLocal={false} />}
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
  download = null,
}: {
  label: string
  icon: React.ReactNode
  sizeBytes: number | null
  localItem: RecordingLibraryItem | null
  allowRemoveLocal?: boolean
  download?: React.ReactNode
}) {
  const [removingLocal, setRemovingLocal] = React.useState(false)
  const hasSize = typeof sizeBytes === "number" && sizeBytes > 0

  const revealLocal = () => {
    if (!localItem) return
    void alloyDesktop()?.recording.revealLibraryCapture(localItem.id)
  }

  const removeLocal = async () => {
    if (!localItem || removingLocal) return
    setRemovingLocal(true)
    try {
      await deleteLocalLibraryCopy(localItem)
      toast.success("Local copy removed")
    } catch (cause) {
      clientLogger.warn("[library] Failed to remove local clip copy.", cause)
      toast.error("Couldn't remove the local copy")
    } finally {
      setRemovingLocal(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Chip size="xl" className="max-w-full justify-start" />}
      >
        {icon}
        <span className="min-w-0 truncate">{label}</span>
        {hasSize ? (
          <span className="text-foreground-faint font-normal">
            ({formatLibraryBytes(sizeBytes)})
          </span>
        ) : null}
        <ChevronDownIcon className="text-foreground-faint" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {localItem ? (
          <>
            <DropdownMenuItem onClick={revealLocal}>
              <FolderOpenIcon />
              Reveal in folder
            </DropdownMenuItem>
            {allowRemoveLocal ? (
              <DropdownMenuItem
                variant="destructive"
                disabled={removingLocal}
                onClick={() => {
                  void removeLocal()
                }}
              >
                <Trash2Icon />
                {removingLocal ? "Removing..." : "Remove local copy"}
              </DropdownMenuItem>
            ) : null}
          </>
        ) : download ? (
          download
        ) : (
          <DropdownMenuItem disabled>
            <CloudIcon />
            Server only
          </DropdownMenuItem>
        )}
        {localItem && download ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <CloudIcon />
              Server copy available
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
