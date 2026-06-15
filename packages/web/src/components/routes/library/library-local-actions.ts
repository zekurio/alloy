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
