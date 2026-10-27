import type { GameRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"

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
  start: () => Promise<void>
  discard: () => Promise<void>
  commit: (metadata: { title: string; game: GameRow }) => Promise<void>
}

export function useImportClipAction(
  desktop: AlloyDesktop | null,
): ImportClipAction {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [picking, setPicking] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [staged, setStaged] = useState<RecordingLibraryStagedImport | null>(
    null,
  )
  // The host keeps a staged pick until it is committed or discarded. This
  // hook can unmount while the native picker is open or the details dialog
  // is up (the upload popover closes), so whatever it still holds, or
  // receives afterwards, is discarded rather than left to the host.
  const mountedRef = useRef(true)
  const stagedRef = useRef<RecordingLibraryStagedImport | null>(null)
  // A commit in flight owns its pick: discarding it would fail the commit.
  const committingIdRef = useRef<string | null>(null)
  useEffect(() => {
    stagedRef.current = staged
  }, [staged])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const current = stagedRef.current
      if (desktop && current && committingIdRef.current !== current.id) {
        discardQuietly(desktop, current.id)
      }
    }
  }, [desktop])

  const available = desktop !== null

  const start = useCallback(async () => {
    if (!desktop || picking || committing || staged) return
    setError(null)
    setPicking(true)
    try {
      const next = await desktop.recording.importLibraryFile()
      if (!next) return
      // A pick whose caller is gone is not kept.
      if (!mountedRef.current) {
        discardQuietly(desktop, next.id)
        return
      }
      setStaged(next)
    } catch (cause) {
      setError(errorMessage(cause, t("Could not import clip.")))
    } finally {
      setPicking(false)
    }
  }, [committing, desktop, picking, staged])

  const discard = useCallback(async () => {
    const current = staged
    if (!current || !desktop || committing) return
    setError(null)
    setStaged(null)
    try {
      await desktop.recording.discardStagedLibraryImport(current.id)
    } catch (cause) {
      setError(errorMessage(cause, t("Could not clear staged import.")))
    }
  }, [committing, desktop, staged])

  const commit = useCallback(
    async ({ title, game }: { title: string; game: GameRow }) => {
      const current = staged
      if (!current || !desktop || committing) return

      setError(null)
      setCommitting(true)
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
        setStaged(null)
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
        setError(errorMessage(cause, t("Could not import clip.")))
      } finally {
        committingIdRef.current = null
        // A failed commit stays staged for another try, unless the dialog
        // that would retry it is gone.
        if (!committed && !mountedRef.current) {
          discardQuietly(desktop, current.id)
        }
        setCommitting(false)
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
    start,
    discard,
    commit,
  }
}

function discardQuietly(desktop: AlloyDesktop, id: string): void {
  void desktop.recording.discardStagedLibraryImport(id).catch(() => {})
}
