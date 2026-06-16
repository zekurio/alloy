import { toast } from "@alloy/ui/lib/toast"

import { clientLogger } from "@/lib/client-log"
import type {
  RecordingLibraryItem,
  RecordingLibraryMetaPatch,
} from "@/lib/desktop"
import { alloyDesktop, notifyLibraryCapturesChanged } from "@/lib/desktop"

export async function deleteLocalLibraryCopy(
  item: RecordingLibraryItem,
): Promise<void> {
  await alloyDesktop()?.recording.deleteLibraryCapture(item.id)
  notifyLibraryCapturesChanged()
}

export async function detachLocalServerLink({
  item,
  serverId,
}: {
  item: RecordingLibraryItem
  serverId: string
}): Promise<void> {
  const desktop = alloyDesktop()
  if (!desktop) return

  const patch: RecordingLibraryMetaPatch = {
    id: item.id,
  }
  if (item.uploadedClipId === serverId) patch.uploadedClipId = null

  await desktop.recording.updateLibraryCapture(patch)
  notifyLibraryCapturesChanged()
}

export async function finishLocalClipDelete({
  deleteLocal,
  localItem,
  serverId,
  setDeletingLocal,
}: {
  deleteLocal: boolean
  localItem: RecordingLibraryItem
  serverId: string
  setDeletingLocal: (deleting: boolean) => void
}): Promise<void> {
  if (deleteLocal) {
    setDeletingLocal(true)
    try {
      await deleteLocalLibraryCopy(localItem)
      toast.success("Clip deleted from server and this device")
    } catch (cause) {
      clientLogger.warn(
        "[library] Failed to delete local clip copy after server delete.",
        cause,
      )
      await detachLocalServerLink({ item: localItem, serverId }).catch(
        () => undefined,
      )
      toast.error(
        "Clip deleted from server, but the local copy couldn't be removed",
      )
    } finally {
      setDeletingLocal(false)
    }
    return
  }

  try {
    await detachLocalServerLink({ item: localItem, serverId })
    toast.success("Clip deleted from server")
  } catch (cause) {
    clientLogger.warn(
      "[library] Failed to detach local clip link after server delete.",
      cause,
    )
    toast.error(
      "Clip deleted from server, but the local sync link couldn't be cleared",
    )
  }
}
