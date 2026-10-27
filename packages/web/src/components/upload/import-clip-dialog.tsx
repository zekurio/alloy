import type { GameRow } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { Card } from "@alloy/ui/components/card"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { Input } from "@alloy/ui/components/input"
import { CircleAlertIcon, UploadIcon, VideoIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { GameCombobox } from "@/components/game/game-combobox"
import { fileExtensionLabel } from "@/components/upload/new-clip-helpers"
import { CLIP_TITLE_MAX, normalizeClipTitle } from "@/lib/clip-fields"
import type { RecordingLibraryStagedImport } from "@/lib/desktop"
import { formatMediaDurationMs } from "@/lib/media-time"
import { formatBytes } from "@/lib/storage-format"

import type { ImportClipAction } from "./import-clip-action"

export function ImportClipDetailsDialog({
  action,
}: {
  action: ImportClipAction
}) {
  const { staged, committing: pending, error } = action
  // The pick the dialog shows. It outlives `staged` so the summary and form
  // stay put while the dialog animates closed.
  const [shown, setShown] = useState(staged)
  if (staged !== null && staged !== shown) setShown(staged)
  const [title, setTitle] = useState("")
  const [game, setGame] = useState<GameRow | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    setTitle(shown?.title ?? "")
    setGame(null)
    setSubmitted(false)
  }, [shown?.id, shown?.title])

  const normalizedTitle = normalizeClipTitle(title)
  const titleInvalid = submitted && normalizedTitle.length === 0
  const gameInvalid = submitted && game === null

  const submit = () => {
    setSubmitted(true)
    if (pending || normalizedTitle.length === 0 || !game) return
    void action.commit({ title: normalizedTitle, game })
  }

  const onOpenChange = (open: boolean) => {
    if (!open) void action.discard()
  }

  return (
    <Dialog open={staged !== null} onOpenChange={onOpenChange}>
      <DialogContent variant="secondary" className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("Import media")}</DialogTitle>
          <DialogDescription>
            {t("Add details before the file enters your library.")}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            {shown ? <StagedImportSummary staged={shown} /> : null}

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
            {error ? (
              <Callout tone="destructive" className="text-xs">
                <CircleAlertIcon />
                <span>{error}</span>
              </Callout>
            ) : null}
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
            <FeedbackButton
              type="submit"
              variant="primary"
              disabled={pending}
              state={pending ? "pending" : error ? "error" : "idle"}
              pendingLabel={t("Importing...")}
              errorLabel={t("Try again")}
            >
              <UploadIcon />
              {t("Import clip")}
            </FeedbackButton>
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
    staged.durationMs && staged.durationMs > 0
      ? formatMediaDurationMs(staged.durationMs)
      : null,
    staged.width && staged.height ? `${staged.width}x${staged.height}` : null,
  ].filter((value): value is string => value !== null)

  return (
    <Card className="min-w-0 flex-row items-center gap-3 p-3">
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
    </Card>
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
