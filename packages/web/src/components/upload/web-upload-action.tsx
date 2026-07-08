import type { ClipPrivacy, GameRow, UserSearchResult } from "@alloy/api"
import { t } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  prepareSelectedClipFile,
  type PublishPayload,
  type SelectedFile,
} from "@/components/upload/new-clip-helpers"
import { useUploadActions } from "@/components/upload/upload-flow-context"
import { absoluteClipHref } from "@/lib/app-paths"
import { nullableClipDescription, parseTagString } from "@/lib/clip-fields"
import { copyTextToClipboard } from "@/lib/clipboard"
import { publicOrigin } from "@/lib/env"
import { errorMessage } from "@/lib/error-message"
import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

export interface WebUploadAction {
  available: boolean
  picking: boolean
  publishing: boolean
  selected: SelectedFile | null
  /** Object URL for the picked file, driving the editor's preview + trimmer. */
  previewUrl: string | null
  select: (file: File | null) => Promise<void>
  discard: () => void
  publish: (metadata: WebUploadMetadata) => Promise<void>
}

export interface WebUploadMetadata {
  title: string
  description: string
  tags: string
  game: GameRow | null
  privacy: ClipPrivacy
  mentions: UserSearchResult[]
  /** Kept source range, in the picked file's timeline. */
  trim: { startMs: number; endMs: number }
  /** False when the range still covers the whole clip; skips the local cut. */
  trimmed: boolean
}

export function useWebUploadAction(): WebUploadAction {
  const { publishClip } = useUploadActions()
  const [picking, setPicking] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [selected, setSelected] = useState<SelectedFile | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const available = typeof File !== "undefined"

  // Revoke the preview URL on unmount without re-running the effect (and
  // tearing the URL down) every time the selection changes.
  const previewUrlRef = useRef<string | null>(null)
  previewUrlRef.current = previewUrl
  useEffect(
    () => () => revokeObjectUrl(previewUrlRef.current, "upload preview URL"),
    [],
  )

  const clearSelection = useCallback(() => {
    setSelected(null)
    setPreviewUrl((current) => {
      revokeObjectUrl(current, "upload preview URL")
      return null
    })
  }, [])

  const select = useCallback(
    async (file: File | null) => {
      if (!file || picking || publishing || selected) return
      setPicking(true)
      try {
        const prepared = await prepareSelectedClipFile(file)
        setSelected(prepared)
        setPreviewUrl(createObjectUrl(prepared.file, "upload preview URL"))
      } catch (cause) {
        toast.error(errorMessage(cause, t("Could not prepare clip.")))
      } finally {
        setPicking(false)
      }
    },
    [picking, publishing, selected],
  )

  const discard = useCallback(() => {
    if (publishing) return
    clearSelection()
  }, [publishing, clearSelection])

  const publish = useCallback(
    async (metadata: WebUploadMetadata) => {
      const current = selected
      if (!current || publishing) return

      setPublishing(true)
      try {
        // Poster capture is slow, so hand it to the upload queue as a
        // deferred job: the editor closes immediately and the capture runs
        // off the picked File in the background. The file itself uploads
        // untouched — the server derives the trim cut at ingest.
        const result = await publishClip({
          kind: "deferred",
          title: metadata.title,
          sizeBytes: current.sizeBytes,
          thumbUrl: null,
          thumbBlurHash: null,
          prepare: (signal) =>
            prepareWebUploadPayload(current, metadata, signal),
        })
        if (!result.clipId) return

        clearSelection()
        if (metadata.privacy === "unlisted") {
          const copied = await copyTextToClipboard(
            absoluteClipHref(
              metadata.game?.slug ?? null,
              result.clipId,
              publicOrigin(),
            ),
            { action: "copy uploaded clip link" },
          )
          if (copied) {
            toast.success(t("Link copied to clipboard"))
          } else {
            toast.error(t("Couldn't copy the clip link"))
          }
          return
        }
        toast.success(t("Upload started"))
      } catch (cause) {
        toast.error(errorMessage(cause, t("Could not start upload.")))
      } finally {
        setPublishing(false)
      }
    },
    [publishClip, publishing, selected, clearSelection],
  )

  return {
    available,
    picking,
    publishing,
    selected,
    previewUrl,
    select,
    discard,
    publish,
  }
}

async function prepareWebUploadPayload(
  selected: SelectedFile,
  metadata: WebUploadMetadata,
  signal: AbortSignal,
): Promise<PublishPayload> {
  throwIfAborted(signal)
  return {
    file: selected.file,
    contentType: selected.contentType,
    title: metadata.title,
    description: nullableClipDescription(metadata.description),
    gameId: metadata.game?.id ?? null,
    privacy: metadata.privacy,
    width: selected.width,
    height: selected.height,
    durationMs: selected.durationMs,
    sizeBytes: selected.sizeBytes,
    mentionedUserIds: metadata.mentions.map((mention) => mention.id),
    tags: parseTagString(metadata.tags),
    trimStartMs: metadata.trimmed ? metadata.trim.startMs : undefined,
    trimEndMs: metadata.trimmed ? metadata.trim.endMs : undefined,
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Upload aborted", "AbortError")
}
