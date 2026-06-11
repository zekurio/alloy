import type { UserSearchResult } from "@alloy/api"
import * as React from "react"

import { normalizeClipTitle } from "@/lib/clip-fields"
import type { AlloyDesktop } from "@/lib/desktop"

/**
 * Saves the editor's draft metadata to the desktop capture store, debounced,
 * so titles, descriptions, tags, and mentions survive app restarts. The
 * initial render is skipped — only actual edits write.
 */
export function useDraftPersistence(
  desktop: AlloyDesktop,
  captureId: string,
  draft: {
    title: string
    description: string
    tags: string
    mentions: UserSearchResult[]
  },
) {
  const firstRunRef = React.useRef(true)
  const { title, description, tags, mentions } = draft

  React.useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false
      return
    }
    const handle = window.setTimeout(() => {
      desktop.recording
        .updateLibraryCapture({
          id: captureId,
          title: normalizeClipTitle(title) || undefined,
          description: description || null,
          tags: tags || null,
          mentions: mentions.map((mention) => ({
            id: mention.id,
            username: mention.username,
            displayUsername: mention.displayUsername,
            name: mention.displayUsername || mention.username,
            image: mention.image,
          })),
        })
        .catch(() => {
          // Draft persistence is best effort; the in-memory state is intact.
        })
    }, 600)
    return () => window.clearTimeout(handle)
  }, [desktop, captureId, title, description, tags, mentions])
}
