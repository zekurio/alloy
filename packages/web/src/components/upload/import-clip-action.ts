import type { GameRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
} from "react"

import { refreshLibrarySnapshotCache } from "@/components/routes/library/library-data"
import { clientLogger } from "@/lib/client-log"
import { normalizeClipTitle } from "@/lib/clip-fields"
import type { AlloyDesktop, RecordingLibraryStagedImport } from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"

export interface ImportClipAction {
  available: boolean
  picking: boolean
  committing: boolean
  error: string | null
  staged: RecordingLibraryStagedImport | null
  /**
   * The last pick, kept after it is committed or discarded so the details
   * dialog can animate closed with it.
   */
  shown: RecordingLibraryStagedImport | null
  start: () => Promise<void>
  discard: () => Promise<void>
  commit: (metadata: { title: string; game: GameRow }) => Promise<void>
}

interface ImportState {
  busy: "picking" | "committing" | null
  /** The latest pick, discard or commit failure; each new one clears it. */
  error: string | null
  staged: RecordingLibraryStagedImport | null
  shown: RecordingLibraryStagedImport | null
}

type ImportEvent =
  | { type: "start"; busy: "picking" | "committing" }
  | { type: "settle" }
  | { type: "fail"; error: string }
  | { type: "stage"; staged: RecordingLibraryStagedImport }
  | { type: "unstage" }

const initialImportState: ImportState = {
  busy: null,
  error: null,
  staged: null,
  shown: null,
}

function importReducer(state: ImportState, event: ImportEvent): ImportState {
  switch (event.type) {
    case "start":
      return { ...state, busy: event.busy, error: null }
    case "settle":
      return { ...state, busy: null }
    case "fail":
      return { ...state, error: event.error }
    case "stage":
      return { ...state, staged: event.staged, shown: event.staged }
    case "unstage":
      return { ...state, staged: null, error: null }
  }
}

export function useImportClipAction(
  desktop: AlloyDesktop | null,
): ImportClipAction {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [state, dispatch] = useReducer(importReducer, initialImportState)
  const { busy, error, staged, shown } = state
  const picking = busy === "picking"
  const committing = busy === "committing"
  // The host keeps a staged pick until it is committed or discarded. This
  // hook can unmount while the native picker is open or the details dialog
  // is up (the upload popover closes), so whatever it still holds, or
  // receives afterwards, is discarded rather than left to the host.
  const mountedRef = useRef(true)
  // A commit in flight owns its pick: discarding it would fail the commit.
  const committingIdRef = useRef<string | null>(null)
  const discardLeftover = useEffectEvent((host: AlloyDesktop | null) => {
    if (host && staged && committingIdRef.current !== staged.id) {
      discardQuietly(host, staged.id)
    }
  })
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      discardLeftover(desktop)
    }
  }, [desktop])

  const available = desktop !== null

  const start = useCallback(async () => {
    if (!desktop || busy || staged) return
    dispatch({ type: "start", busy: "picking" })
    try {
      const next = await desktop.recording.importLibraryFile()
      if (!next) return
      // A pick whose caller is gone is not kept.
      if (!mountedRef.current) {
        discardQuietly(desktop, next.id)
        return
      }
      dispatch({ type: "stage", staged: next })
    } catch (cause) {
      dispatch({
        type: "fail",
        error: errorMessage(cause, t("Could not import clip.")),
      })
    } finally {
      dispatch({ type: "settle" })
    }
  }, [busy, desktop, staged])

  const discard = useCallback(async () => {
    const current = staged
    if (!current || !desktop || committing) return
    dispatch({ type: "unstage" })
    try {
      await desktop.recording.discardStagedLibraryImport(current.id)
    } catch (cause) {
      dispatch({
        type: "fail",
        error: errorMessage(cause, t("Could not clear staged import.")),
      })
    }
  }, [committing, desktop, staged])

  const commit = useCallback(
    async ({ title, game }: { title: string; game: GameRow }) => {
      const current = staged
      if (!current || !desktop || committing) return

      dispatch({ type: "start", busy: "committing" })
      committingIdRef.current = current.id
      let committed = false
      try {
        const result = await desktop.recording.commitStagedLibraryImport({
          id: current.id,
          title: normalizeClipTitle(title),
          gameName: game.name,
          gameIconUrl: game.iconUrl ?? game.logoUrl,
        })
        committed = true
        dispatch({ type: "unstage" })
        // The clip is in the library now. Refreshing the snapshot and opening
        // it are follow-ups whose failure must not report a failed import.
        try {
          await refreshLibrarySnapshotCache(queryClient, desktop)
        } catch (cause) {
          clientLogger.warn("[import] Failed to refresh library.", cause)
        }
        try {
          await navigate({
            to: "/library/$captureId",
            params: { captureId: result.id },
          })
        } catch (cause) {
          clientLogger.warn(
            `[import] Failed to open capture ${result.id}.`,
            cause,
          )
        }
      } catch (cause) {
        dispatch({
          type: "fail",
          error: errorMessage(cause, t("Could not import clip.")),
        })
      } finally {
        committingIdRef.current = null
        // A failed commit stays staged for another try, unless the dialog
        // that would retry it is gone.
        if (!committed && !mountedRef.current) {
          discardQuietly(desktop, current.id)
        }
        dispatch({ type: "settle" })
      }
    },
    [committing, desktop, navigate, queryClient, staged],
  )

  return {
    available,
    picking,
    committing,
    error,
    staged,
    shown,
    start,
    discard,
    commit,
  }
}

function discardQuietly(desktop: AlloyDesktop, id: string): void {
  void desktop.recording.discardStagedLibraryImport(id).catch(() => {})
}
