import type { GameRow } from "@alloy/api"
import { t, tp } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import { Input } from "@alloy/ui/components/input"
import { toast } from "@alloy/ui/lib/toast"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { UploadIcon, VideoIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { GameCombobox } from "@/components/game/game-combobox"
import { fileExtensionLabel } from "@/components/upload/new-clip-helpers"
import { CLIP_TITLE_MAX, normalizeClipTitle } from "@/lib/clip-fields"
import {
  type AlloyDesktop,
  type RecordingLibraryStagedImport,
} from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"

import { formatLibraryBytes, refreshLibrarySnapshotCache } from "./library-data"

export interface LibraryImportAction {
  available: boolean
  picking: boolean
  committing: boolean
  staged: RecordingLibraryStagedImport | null
  start: () => Promise<void>
  discard: () => Promise<void>
  commit: (metadata: { title: string; game: GameRow }) => Promise<void>
}

export function useLibraryImportAction(
  desktop: AlloyDesktop | null,
): LibraryImportAction {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [picking, setPicking] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [staged, setStaged] = useState<RecordingLibraryStagedImport | null>(
    null,
  )

  const available =
    !!desktop?.recording.importLibraryFiles &&
    !!desktop.recording.commitStagedLibraryImport &&
    !!desktop.recording.discardStagedLibraryImport

  const start = useCallback(async () => {
    const pick = desktop?.recording.importLibraryFiles
    if (!pick || !available || picking || committing || staged) return
    setPicking(true)
    try {
      const result = await pick()
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
  }, [available, committing, desktop, picking, staged])

  const discard = useCallback(async () => {
    const current = staged
    const discardStaged = desktop?.recording.discardStagedLibraryImport
    if (!current || !discardStaged || committing) return
    setStaged(null)
    try {
      await discardStaged(current.id)
    } catch (cause) {
      toast.error(errorMessage(cause, t("Could not clear staged import.")))
    }
  }, [committing, desktop, staged])

  const commit = useCallback(
    async ({ title, game }: { title: string; game: GameRow }) => {
      const current = staged
      const commitStaged = desktop?.recording.commitStagedLibraryImport
      if (!current || !commitStaged || committing) return

      setCommitting(true)
      try {
        const result = await commitStaged({
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

export function ImportClipDetailsDialog({
  action,
}: {
  action: LibraryImportAction
}) {
  return (
    <ImportClipDetailsDialogInner
      staged={action.staged}
      pending={action.committing}
      onOpenChange={(open) => {
        if (!open) void action.discard()
      }}
      onCommit={(metadata) => {
        void action.commit(metadata)
      }}
    />
  )
}

function ImportClipDetailsDialogInner({
  staged,
  pending,
  onOpenChange,
  onCommit,
}: {
  staged: RecordingLibraryStagedImport | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onCommit: (metadata: { title: string; game: GameRow }) => void
}) {
  const [title, setTitle] = useState("")
  const [game, setGame] = useState<GameRow | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    setTitle(staged?.title ?? "")
    setGame(null)
    setSubmitted(false)
  }, [staged?.id, staged?.title])

  const normalizedTitle = normalizeClipTitle(title)
  const titleInvalid = submitted && normalizedTitle.length === 0
  const gameInvalid = submitted && game === null

  const submit = () => {
    setSubmitted(true)
    if (pending || normalizedTitle.length === 0 || !game) return
    onCommit({ title: normalizedTitle, game })
  }

  return (
    <Dialog open={staged !== null} onOpenChange={onOpenChange}>
      <DialogContent variant="secondary" className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("Import clip")}</DialogTitle>
          <DialogDescription>
            {t("Add the clip details before it enters your library.")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            {staged ? <StagedImportSummary staged={staged} /> : null}

            <label className="flex flex-col gap-2">
              <span className="text-foreground-muted text-xs font-semibold">
                {t("Title")}
              </span>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={CLIP_TITLE_MAX}
                disabled={pending}
                aria-invalid={titleInvalid || undefined}
                placeholder={t("Untitled")}
              />
              {titleInvalid ? (
                <span className="text-destructive text-xs">
                  {t("Add a title to import this clip.")}
                </span>
              ) : null}
            </label>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="import-clip-game"
                className="text-foreground-muted text-xs font-semibold"
              >
                {t("Game")}
              </label>
              <GameCombobox
                id="import-clip-game"
                value={game}
                onChange={setGame}
                disabled={pending}
                invalid={gameInvalid}
                required
                placeholder={t("Search game...")}
                className="w-full"
                inputClassName="w-full"
              />
              {gameInvalid ? (
                <span className="text-destructive text-xs">
                  {t("Pick a game to import this clip.")}
                </span>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {t("Cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              <UploadIcon />
              {pending ? t("Importing...") : t("Import clip")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function StagedImportSummary({
  staged,
}: {
  staged: RecordingLibraryStagedImport
}) {
  const details = [
    formatLibraryBytes(staged.sizeBytes),
    formatStagedDuration(staged.durationMs),
    staged.width && staged.height ? `${staged.width}x${staged.height}` : null,
  ].filter((value): value is string => value !== null)

  return (
    <div className="border-border bg-surface-raised/60 flex min-w-0 items-center gap-3 rounded-md border p-3">
      <FileTypeChip fileName={staged.fileName} />
      <div className="min-w-0">
        <p className="text-foreground truncate text-sm font-semibold">
          {staged.fileName}
        </p>
        {details.length > 0 ? (
          <p className="text-foreground-muted truncate text-xs">
            {details.join(" - ")}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function FileTypeChip({ fileName }: { fileName: string }) {
  const extension = fileExtensionLabel(fileName)
  return (
    <div className="border-accent-border bg-accent-soft text-accent grid size-9 shrink-0 place-items-center rounded-md border">
      {extension ? (
        <span className="text-2xs font-mono font-semibold tracking-[0.06em] tabular-nums">
          {extension}
        </span>
      ) : (
        <VideoIcon className="size-4" />
      )}
    </div>
  )
}

function formatStagedDuration(durationMs: number | null): string | null {
  if (!durationMs || durationMs <= 0) return null
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}
