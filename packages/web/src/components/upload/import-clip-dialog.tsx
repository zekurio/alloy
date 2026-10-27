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
import { useForm, useStore } from "@tanstack/react-form"
import { CircleAlertIcon, UploadIcon, VideoIcon } from "lucide-react"

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
  // `shown` outlives `staged` so the summary and form stay put while the
  // dialog animates closed.
  const { staged, shown } = action

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
        {/* The host gives every staged copy a fresh id, so the id tells a new
            pick (even of the same file) from a new object for the same one:
            only a new pick starts the form over. */}
        {shown ? (
          <ImportClipForm
            key={shown.id}
            staged={shown}
            action={action}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

type ImportClipValues = {
  title: string
  game: GameRow | null
}

function ImportClipForm({
  staged,
  action,
  onCancel,
}: {
  staged: RecordingLibraryStagedImport
  action: ImportClipAction
  onCancel: () => void
}) {
  const { committing: pending, error } = action
  const defaultValues: ImportClipValues = {
    title: staged.title ?? "",
    game: null,
  }
  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) => {
      if (pending || !value.game) return
      void action.commit({
        title: normalizeClipTitle(value.title),
        game: value.game,
      })
    },
  })
  // Missing fields are flagged once the user tries to import, not before.
  const submitted = useStore(
    form.store,
    (state) => state.submissionAttempts > 0,
  )

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <DialogBody className="flex flex-col gap-4">
        <StagedImportSummary staged={staged} />

        <form.Field
          name="title"
          validators={{
            onChange: ({ value }) =>
              normalizeClipTitle(value).length === 0
                ? t("Add a title to import this clip.")
                : undefined,
          }}
        >
          {(field) => {
            const invalid = submitted && !field.state.meta.isValid
            return (
              <label className="flex flex-col gap-2">
                <span className="text-foreground-muted text-xs font-semibold">
                  {t("Title")}
                </span>
                <Input
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  maxLength={CLIP_TITLE_MAX}
                  disabled={pending}
                  aria-invalid={invalid || undefined}
                  placeholder={t("Untitled")}
                />
                {invalid ? (
                  <span className="text-destructive text-xs">
                    {t("Add a title to import this clip.")}
                  </span>
                ) : null}
              </label>
            )
          }}
        </form.Field>

        <form.Field
          name="game"
          validators={{
            onChange: ({ value }) =>
              value === null
                ? t("Pick a game to import this clip.")
                : undefined,
          }}
        >
          {(field) => {
            const invalid = submitted && !field.state.meta.isValid
            return (
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="import-clip-game"
                  className="text-foreground-muted text-xs font-semibold"
                >
                  {t("Game")}
                </label>
                <GameCombobox
                  id="import-clip-game"
                  value={field.state.value}
                  onChange={field.handleChange}
                  disabled={pending}
                  invalid={invalid}
                  required
                  placeholder={t("Search game...")}
                  className="w-full"
                  inputClassName="w-full"
                />
                {invalid ? (
                  <span className="text-destructive text-xs">
                    {t("Pick a game to import this clip.")}
                  </span>
                ) : null}
              </div>
            )
          }}
        </form.Field>
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
          onClick={onCancel}
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
