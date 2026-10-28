import {
  type ClipPrivacy,
  type GameRow,
  throwIfAborted,
  type UserSearchResult,
} from "@alloy/api"
import { t } from "@alloy/i18n"
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react"

import {
  exportScreenshot,
  type ScreenshotEdit,
} from "@/components/media/screenshot-edit"
import { loadLibraryEditorPage } from "@/components/routes/library/load-library-editor-page"
import {
  prepareSelectedClipFile,
  type PublishClipInput,
  type PublishPayload,
  type SelectedFile,
} from "@/components/upload/new-clip-helpers"
import type { PublishClipFn } from "@/components/upload/upload-flow-context"
import { api } from "@/lib/api"
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
  screenshotEdit?: ScreenshotEdit
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

interface WebUploadState {
  picking: boolean
  selection: { file: SelectedFile; previewUrl: string | null } | null
  publishing: boolean
  /**
   * The pick's or the publish's failure. A pick only starts with nothing
   * selected and a publish only with a selection, so one slot covers both.
   */
  error: string | null
  /** An unlisted clip's link, kept after the copy failed so it can retry. */
  linkToCopy: string | null
}

type PublishOutcome = { error?: string; linkToCopy?: string }

type WebUploadEvent =
  | { type: "pick" }
  | { type: "picked"; file: SelectedFile; previewUrl: string | null }
  | { type: "pickFailed"; error: string }
  | { type: "publish" }
  | ({ type: "published" } & PublishOutcome)
  | { type: "clear" }

const initialWebUploadState: WebUploadState = {
  picking: false,
  selection: null,
  publishing: false,
  error: null,
  linkToCopy: null,
}

function webUploadReducer(
  state: WebUploadState,
  event: WebUploadEvent,
): WebUploadState {
  switch (event.type) {
    case "pick":
      return { ...state, picking: true, error: null }
    case "picked":
      return {
        ...state,
        picking: false,
        selection: { file: event.file, previewUrl: event.previewUrl },
      }
    case "pickFailed":
      return { ...state, picking: false, error: event.error }
    case "publish":
      return { ...state, publishing: true, error: null }
    case "published":
      return {
        ...state,
        publishing: false,
        error: event.error ?? state.error,
        linkToCopy: event.linkToCopy ?? state.linkToCopy,
      }
    case "clear":
      return { ...state, selection: null, error: null, linkToCopy: null }
  }
}

export function useWebUploadAction(
  publishClip: PublishClipFn,
): WebUploadAction {
  const [state, dispatch] = useReducer(webUploadReducer, initialWebUploadState)
  const { picking, selection, publishing, error, linkToCopy } = state
  const selected = selection?.file ?? null
  // Owns the live object URL. Written only where the URL is created or
  // revoked, so a render that never commits cannot change what gets revoked.
  const previewUrlRef = useRef<string | null>(null)
  const mountedRef = useRef(false)
  const revokePreviewUrl = useCallback(() => {
    revokeObjectUrl(previewUrlRef.current, "upload preview URL")
    previewUrlRef.current = null
  }, [])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      revokePreviewUrl()
    }
  }, [revokePreviewUrl])

  const clear = useCallback(() => {
    revokePreviewUrl()
    dispatch({ type: "clear" })
  }, [revokePreviewUrl])

  const select = useCallback(
    async (file: File | null) => {
      if (!file || picking || publishing || selected) return
      dispatch({ type: "pick" })
      // Fetch the editor while the picked file is still being probed.
      void loadLibraryEditorPage().catch(() => {})
      try {
        const prepared = await prepareSelectedClipFile(file)
        // Unmounted while preparing: nothing would ever revoke a new URL.
        if (!mountedRef.current) return
        revokePreviewUrl()
        const url = createObjectUrl(prepared.file, "upload preview URL")
        previewUrlRef.current = url
        // A transition keeps the current page, and the trigger's spinner, up
        // while the editor's chunk loads instead of blanking the main area.
        startTransition(() => {
          dispatch({ type: "picked", file: prepared, previewUrl: url })
        })
      } catch (cause) {
        dispatch({
          type: "pickFailed",
          error: errorMessage(cause, t("Could not prepare clip.")),
        })
      }
    },
    [picking, publishing, selected, revokePreviewUrl],
  )

  const discard = useCallback(() => {
    if (publishing) return
    clear()
  }, [publishing, clear])

  const publish = useCallback(
    async (metadata: WebUploadMetadata) => {
      if (!selected || publishing || linkToCopy) return
      dispatch({ type: "publish" })
      let outcome: PublishOutcome = {}
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
            outcome = {
              linkToCopy: link,
              error: t("Upload started, but the clip link couldn't be copied."),
            }
            return
          }
        }
        clear()
      } catch (cause) {
        outcome = { error: errorMessage(cause, t("Could not start upload.")) }
      } finally {
        dispatch({ type: "published", ...outcome })
      }
    },
    [publishClip, selected, publishing, linkToCopy, clear],
  )

  const retryLinkCopy = useCallback(async () => {
    if (!linkToCopy || publishing) return
    dispatch({ type: "publish" })
    let outcome: PublishOutcome = {}
    try {
      if (!(await copyUploadedClipLink(linkToCopy))) {
        outcome = {
          error: t("Upload started, but the clip link couldn't be copied."),
        }
        return
      }
      clear()
    } finally {
      dispatch({ type: "published", ...outcome })
    }
  }, [linkToCopy, publishing, clear])

  return useMemo(
    () => ({
      available: Boolean(globalThis.File),
      picking,
      publishing,
      error,
      awaitingLinkCopy: linkToCopy !== null,
      selected,
      previewUrl: selection?.previewUrl ?? null,
      select,
      discard,
      publish,
      retryLinkCopy,
    }),
    [
      picking,
      publishing,
      error,
      linkToCopy,
      selected,
      selection,
      select,
      discard,
      publish,
      retryLinkCopy,
    ],
  )
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

export async function prepareWebUploadPayload(
  selected: SelectedFile,
  metadata: WebUploadMetadata,
  signal: AbortSignal,
): Promise<PublishPayload> {
  throwIfAborted(signal, "Upload aborted")
  if (selected.contentType.startsWith("image/")) {
    if (metadata.screenshotEdit) {
      const server = await api.serverInfo.fetch()
      selected = await prepareSelectedClipFile(
        await exportScreenshot(
          selected.file,
          metadata.screenshotEdit,
          server.uploadLimits,
        ),
      )
    }
  }
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
