import type { GameRow } from "@alloy/api"
import { t } from "@alloy/i18n"
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
import { UploadIcon, VideoIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { GameCombobox } from "@/components/game/game-combobox"
import { fileExtensionLabel } from "@/components/upload/new-clip-helpers"
import { CLIP_TITLE_MAX, normalizeClipTitle } from "@/lib/clip-fields"
import type { RecordingLibraryStagedImport } from "@/lib/desktop"
import { formatBytes } from "@/lib/storage-format"

import type { ImportClipAction } from "./import-clip-action"

export function ImportClipDetailsDialog({
  action,
}: {
  action: ImportClipAction
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
    formatBytes(staged.sizeBytes),
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

function FileTypeChip({ fileName }: { fileName: string }) {
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
