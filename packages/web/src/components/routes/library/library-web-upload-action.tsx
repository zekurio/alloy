import type { ClipPrivacy, GameRow, UserSearchResult } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { toast } from "@alloy/ui/lib/toast"
import { Loader2Icon, UploadIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  ACCEPT_LIST,
  captureThumbnail,
  prepareSelectedClipFile,
  type PublishPayload,
  type SelectedFile,
} from "@/components/upload/new-clip-helpers"
import { useUploadFlowControls } from "@/components/upload/use-upload-flow-controls"
import { absoluteClipHref } from "@/lib/app-paths"
import { nullableClipDescription, parseTagString } from "@/lib/clip-fields"
import { copyTextToClipboard } from "@/lib/clipboard"
import { publicOrigin } from "@/lib/env"
import { errorMessage } from "@/lib/error-message"
import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"
import { trimFileToMp4 } from "@/lib/trim-file"

export interface LibraryWebUploadAction {
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

export function useLibraryWebUploadAction(): LibraryWebUploadAction {
  const { publishClip } = useUploadFlowControls()
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
        // Trimming and poster capture are slow, so hand them to the upload
        // queue as a deferred job: the editor closes immediately and the cut
        // runs off the picked File in the background.
        const result = await publishClip({
          kind: "deferred",
          title: metadata.title,
          sizeBytes: estimatedUploadSizeBytes(current, metadata),
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
  const sourceFile = metadata.trimmed
    ? await trimFileToMp4(selected.file, {
        startMs: metadata.trim.startMs,
        endMs: metadata.trim.endMs,
        signal,
      })
    : selected.file
  throwIfAborted(signal)
  // Re-validate and re-probe: the cut file has its own duration/dimensions and
  // must clear the same upload checks a freshly picked file does.
  const prepared = await prepareSelectedClipFile(sourceFile)
  throwIfAborted(signal)
  // Sample the poster from the cut file — the keyframe snap means the original
  // frame at the requested start may not survive the trim.
  const thumbnail = await captureThumbnail(
    prepared.file,
    Math.min(1000, Math.max(0, prepared.durationMs - 100)),
  )

  return {
    file: prepared.file,
    contentType: prepared.contentType,
    title: metadata.title,
    description: nullableClipDescription(metadata.description),
    gameId: metadata.game?.id ?? null,
    privacy: metadata.privacy,
    width: prepared.width,
    height: prepared.height,
    durationMs: prepared.durationMs,
    sizeBytes: prepared.sizeBytes,
    thumbBlob: thumbnail.blob,
    thumbBlurHash: thumbnail.blurHash,
    mentionedUserIds: metadata.mentions.map((mention) => mention.id),
    tags: parseTagString(metadata.tags),
  }
}

function estimatedUploadSizeBytes(
  selected: SelectedFile,
  metadata: WebUploadMetadata,
): number {
  if (!metadata.trimmed || !(selected.durationMs > 0)) return selected.sizeBytes
  const ratio =
    Math.max(0, metadata.trim.endMs - metadata.trim.startMs) /
    selected.durationMs
  return Math.max(1, Math.round(selected.sizeBytes * Math.min(1, ratio)))
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Upload aborted", "AbortError")
}

export function LibraryWebUploadButton({
  action,
}: {
  action: LibraryWebUploadAction
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const pending = action.picking || action.publishing

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_LIST}
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0] ?? null
          event.currentTarget.value = ""
          void action.select(file)
        }}
      />
      <Button
        type="button"
        variant="primary"
        size="sm"
        disabled={!action.available || pending || action.selected !== null}
        title={
          action.available
            ? t("Upload clip")
            : t("Uploads are unavailable in this browser")
        }
        onClick={() => {
          inputRef.current?.click()
        }}
      >
        {action.picking ? (
          <Loader2Icon className="animate-spin" />
        ) : (
          <UploadIcon />
        )}
        {action.picking ? t("Reading...") : t("Upload clip")}
      </Button>
    </>
  )
}
