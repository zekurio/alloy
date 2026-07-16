import type { GameRow } from "@alloy/api"
import { t, tp } from "@alloy/i18n"
import { toast } from "@alloy/ui/lib/toast"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useCallback, useState } from "react"

import { refreshLibrarySnapshotCache } from "@/components/routes/library/library-data"
import { normalizeClipTitle } from "@/lib/clip-fields"
import type { AlloyDesktop, RecordingLibraryStagedImport } from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"

export interface ImportClipAction {
  available: boolean
  picking: boolean
  committing: boolean
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
  const [staged, setStaged] = useState<RecordingLibraryStagedImport | null>(
    null,
  )

  const available = desktop !== null

  const start = useCallback(async () => {
    if (!desktop || picking || committing || staged) return
    setPicking(true)
    try {
      const result = await desktop.recording.importLibraryFiles()
      if (result.canceled) return
      if (result.failed.length > 0) {
        const [first] = result.failed
        toast.error(
          result.failed.length === 1
            ? t("{fileName}: {error}", {
                error: first.error,
                fileName: first.fileName,
              })
            : tp(
                result.failed.length,
                "{count} file couldn't be imported.",
                "{count} files couldn't be imported.",
                {
                  count: result.failed.length,
                },
              ),
        )
      }
      const [next] = result.staged
      if (next) setStaged(next)
    } catch (cause) {
      toast.error(errorMessage(cause, t("Could not import clip.")))
    } finally {
      setPicking(false)
    }
  }, [committing, desktop, picking, staged])

  const discard = useCallback(async () => {
    const current = staged
    if (!current || !desktop || committing) return
    setStaged(null)
    try {
      await desktop.recording.discardStagedLibraryImport(current.id)
    } catch (cause) {
      toast.error(errorMessage(cause, t("Could not clear staged import.")))
    }
  }, [committing, desktop, staged])

  const commit = useCallback(
    async ({ title, game }: { title: string; game: GameRow }) => {
      const current = staged
      if (!current || !desktop || committing) return

      setCommitting(true)
      try {
        const result = await desktop.recording.commitStagedLibraryImport({
          id: current.id,
          title: normalizeClipTitle(title),
          gameName: game.name,
          gameIconUrl: game.iconUrl ?? game.logoUrl,
        })
        await refreshLibrarySnapshotCache(queryClient, desktop)
        toast.success(t("Clip imported to your library"))
        await navigate({
          to: "/library/$captureId",
          params: { captureId: result.id },
        })
        setStaged(null)
      } catch (cause) {
        toast.error(errorMessage(cause, t("Could not import clip.")))
      } finally {
        setCommitting(false)
      }
    },
    [committing, desktop, navigate, queryClient, staged],
  )

  return { available, picking, committing, staged, start, discard, commit }
}
