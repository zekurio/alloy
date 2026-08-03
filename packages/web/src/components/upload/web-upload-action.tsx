import type { ClipPrivacy, GameRow, UserSearchResult } from "@alloy/api"
import { t } from "@alloy/i18n"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  prepareSelectedClipFile,
  type PublishClipInput,
  type PublishPayload,
  type SelectedFile,
} from "@/components/upload/new-clip-helpers"
import {
  type PublishClipFn,
  useUploadActions,
} from "@/components/upload/upload-flow-context"
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
  error: string | null
  awaitingLinkCopy: boolean
  selected: SelectedFile | null
  /** Object URL for the picked file, driving the editor's preview + trimmer. */
  previewUrl: string | null
  select: (file: File | null) => Promise<void>
  discard: () => void
  publish: (metadata: WebUploadMetadata) => Promise<void>
  retryLinkCopy: () => Promise<void>
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
  const actions = useUploadActions()
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [linkToCopy, setLinkToCopy] = useState<string | null>(null)
  const selection = useWebUploadSelection(publishing)
  const clear = useCallback(() => {
    setPublishError(null)
    setLinkToCopy(null)
    selection.clear()
  }, [selection.clear])
  const publish = usePublishSelectedFile(
    actions.publishClip,
    selection.selected,
    publishing,
    linkToCopy,
    clear,
    setPublishing,
    setPublishError,
    setLinkToCopy,
  )
  const retryLinkCopy = useRetryLinkCopy(
    linkToCopy,
    publishing,
    clear,
    setPublishing,
    setPublishError,
  )
  const discard = useCallback(() => {
    setPublishError(null)
    setLinkToCopy(null)
    selection.discard()
  }, [selection.discard])

  return {
    available: typeof File !== "undefined",
    picking: selection.picking,
    publishing,
    error: publishError ?? selection.error,
    awaitingLinkCopy: linkToCopy !== null,
    selected: selection.selected,
    previewUrl: selection.previewUrl,
    select: selection.select,
    discard,
    publish,
    retryLinkCopy,
  }
}

function useWebUploadSelection(publishing: boolean) {
  const [picking, setPicking] = useState(false)
  const [selected, setSelected] = useState<SelectedFile | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Keep the latest URL available to the unmount-only cleanup.
  const previewUrlRef = useRef<string | null>(null)
  previewUrlRef.current = previewUrl
  useEffect(
    () => () => revokeObjectUrl(previewUrlRef.current, "upload preview URL"),
    [],
  )

  const clear = useCallback(() => {
    setError(null)
    setSelected(null)
    setPreviewUrl((current) => {
      revokeObjectUrl(current, "upload preview URL")
      return null
    })
  }, [])
  const select = useCallback(
    async (file: File | null) => {
      if (!file || picking || publishing || selected) return
      setError(null)
      setPicking(true)
      try {
        const prepared = await prepareSelectedClipFile(file)
        setSelected(prepared)
        setPreviewUrl(createObjectUrl(prepared.file, "upload preview URL"))
      } catch (cause) {
        setError(errorMessage(cause, t("Could not prepare clip.")))
      } finally {
        setPicking(false)
      }
    },
    [picking, publishing, selected],
  )
  const discard = useCallback(() => {
    if (publishing) return
    clear()
  }, [publishing, clear])

  return { picking, selected, previewUrl, error, select, discard, clear }
}

function usePublishSelectedFile(
  publishClip: PublishClipFn,
  selected: SelectedFile | null,
  publishing: boolean,
  linkToCopy: string | null,
  clearSelection: () => void,
  setPublishing: (value: boolean) => void,
  setPublishError: (value: string | null) => void,
  setLinkToCopy: (value: string | null) => void,
) {
  return useCallback(
    async (metadata: WebUploadMetadata) => {
      if (!selected || publishing || linkToCopy) return
      setPublishError(null)
      setPublishing(true)
      try {
        const result = await publishClip(
          createDeferredWebUpload(selected, metadata),
        )
        if (!result.clipId) return
        if (metadata.privacy === "unlisted") {
          const link = absoluteClipHref(
            metadata.game?.slug ?? null,
            result.clipId,
            publicOrigin(),
          )
          if (!(await copyUploadedClipLink(link))) {
            setLinkToCopy(link)
            setPublishError(
              t("Upload started, but the clip link couldn't be copied."),
            )
            return
          }
        }
        clearSelection()
      } catch (cause) {
        setPublishError(errorMessage(cause, t("Could not start upload.")))
      } finally {
        setPublishing(false)
      }
    },
    [
      publishClip,
      selected,
      publishing,
      linkToCopy,
      clearSelection,
      setPublishing,
      setPublishError,
      setLinkToCopy,
    ],
  )
}

function useRetryLinkCopy(
  linkToCopy: string | null,
  publishing: boolean,
  clearSelection: () => void,
  setPublishing: (value: boolean) => void,
  setPublishError: (value: string | null) => void,
) {
  return useCallback(async () => {
    if (!linkToCopy || publishing) return
    setPublishError(null)
    setPublishing(true)
    try {
      if (!(await copyUploadedClipLink(linkToCopy))) {
        setPublishError(
          t("Upload started, but the clip link couldn't be copied."),
        )
        return
      }
      clearSelection()
    } finally {
      setPublishing(false)
    }
  }, [linkToCopy, publishing, clearSelection, setPublishing, setPublishError])
}

function createDeferredWebUpload(
  selected: SelectedFile,
  metadata: WebUploadMetadata,
): PublishClipInput {
  // Poster capture is slow, so the queue prepares it after the editor closes.
  // The original file uploads untouched; the server applies the trim at ingest.
  return {
    kind: "deferred",
    title: metadata.title,
    sizeBytes: selected.sizeBytes,
    thumbUrl: null,
    thumbBlurHash: null,
    prepare: (signal) => prepareWebUploadPayload(selected, metadata, signal),
  }
}

async function copyUploadedClipLink(link: string) {
  return copyTextToClipboard(link, { action: "copy uploaded clip link" })
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
