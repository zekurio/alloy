import { useMemo } from "react"

import { useLibrarySnapshot } from "@/components/routes/library/library-data"
import { alloyDesktop, type RecordingLibraryItem } from "@/lib/desktop"

export function useLocalClipPlayback(clipId: string): {
  items: RecordingLibraryItem[]
  localItem: RecordingLibraryItem | null
  settled: boolean
} {
  const library = useLibrarySnapshot(alloyDesktop(), { toastErrors: false })
  const items = useMemo(() => {
    if (!library.snapshot) return []
    return library.snapshot.items
      .filter((item) => item.uploadedClipId === clipId)
      .sort(compareLibraryItemNewestFirst)
  }, [clipId, library.snapshot])
  const settled = Boolean(library.snapshot) || !library.refreshing

  return useMemo(
    () => ({
      items,
      localItem: items[0] ?? null,
      settled,
    }),
    [items, settled],
  )
}

function compareLibraryItemNewestFirst(
  a: RecordingLibraryItem,
  b: RecordingLibraryItem,
): number {
  const modifiedDelta = Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt)
  if (modifiedDelta !== 0) return modifiedDelta
  return a.id.localeCompare(b.id)
}
