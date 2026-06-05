import * as React from "react"
import { useForm } from "@tanstack/react-form"
import { UploadIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/lib/toast"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
} from "@workspace/ui/components/drawer"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import { cn } from "@workspace/ui/lib/utils"

import {
  CLIP_DESCRIPTION_MAX,
  CLIP_TITLE_MAX,
  normalizeClipTitle,
  nullableClipDescription,
} from "@/lib/clip-fields"
import { validateRequiredString } from "@/lib/form-validators"
import type { GameRow, UserSearchResult } from "@workspace/api"

import { ClipPrivacyPicker } from "@/components/clip/clip-privacy-picker"
import { LimitedInput, LimitedTextarea } from "@/components/form/limited-field"
import { GameCombobox } from "@/components/game/game-combobox"
import { GameSuggestion } from "@/components/game/game-suggestion"
import { MentionPicker } from "@/components/search/mention-picker"
import { VideoPlayer } from "@/components/video/video-player"
import {
  useGamePreviewByNameQuery,
  useResolveGameMutation,
} from "@/lib/game-queries"
import { errorMessage } from "@/lib/error-message"
import { useMlConfigQuery } from "@/lib/ml-queries"
import { useGameSuggestionQuery } from "./use-game-suggestion"
import {
  captureThumbnail,
  type PublishPayload,
  type SelectedFile,
  stripExtension,
  type Visibility,
} from "./new-clip-helpers"

export type {
  PublishPayload,
  SelectedFile,
  Visibility,
} from "./new-clip-helpers"

interface NewClipDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPublish: (payload: PublishPayload) => Promise<void> | void
  initialFile?: SelectedFile
}

export function NewClipDialog({
  open,
  onOpenChange,
  onPublish,
  initialFile,
}: NewClipDialogProps) {
  const isMobile = useIsMobile()
  const [selectedFile, setSelectedFile] = React.useState<SelectedFile | null>(
    null,
  )
  const [publishing, setPublishing] = React.useState(false)

  React.useEffect(() => {
    if (open && initialFile) {
      setSelectedFile(initialFile)
    }
  }, [open, initialFile])

  // Reset everything *after* the close animation finishes so the reset
  // doesn't bleed through the dialog's ~100ms fade/zoom-out.
  const handleOpenChangeComplete = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedFile(null)
      setPublishing(false)
    }
  }, [])

  const handlePublish = React.useCallback(
    async (payload: PublishPayload) => {
      setPublishing(true)
      try {
        await onPublish(payload)
      } catch (cause) {
        toast.error(errorMessage(cause, "Couldn't publish clip"))
      } finally {
        setPublishing(false)
      }
    },
    [onPublish],
  )

  // Use the initial file as a synchronous fallback so the modal renders
  // LoadedState immediately on first open without waiting for the effect.
  const activeFile = selectedFile ?? (open ? (initialFile ?? null) : null)
  const activeFileKey = activeFile
    ? `${activeFile.name}:${activeFile.sizeBytes}:${activeFile.durationMs}`
    : null

  const surfaceContent = (
    <>
      {isMobile
        ? (
          <div className="shrink-0 px-4 pt-4 pb-4">
            <DrawerTitle className="text-lg leading-tight font-semibold tracking-[var(--tracking-tight)] text-foreground">
              New clip
            </DrawerTitle>
          </div>
        )
        : (
          <DialogHeader className="shrink-0">
            <DialogTitle>New clip</DialogTitle>
          </DialogHeader>
        )}

      {activeFile
        ? (
          <LoadedState
            key={activeFileKey}
            file={activeFile}
            publishing={publishing}
            onPublish={handlePublish}
            closeAction={isMobile
              ? (
                <DrawerClose asChild>
                  <Button
                    variant="ghost"
                    size="default"
                    disabled={publishing}
                    className="w-full min-w-0"
                  >
                    Cancel
                  </Button>
                </DrawerClose>
              )
              : (
                <DialogClose
                  render={
                    <Button
                      variant="ghost"
                      size="default"
                      disabled={publishing}
                    />
                  }
                >
                  Cancel
                </DialogClose>
              )}
          />
        )
        : null}
    </>
  )

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next)
          if (!next) handleOpenChangeComplete(false)
        }}
      >
        <DrawerContent
          className="max-h-[92dvh] bg-surface"
          aria-describedby={undefined}
        >
          {surfaceContent}
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={handleOpenChangeComplete}
    >
      <DialogContent
        variant="secondary"
        disableZoom
        centered={!isMobile}
        className={cn(
          "flex flex-col overflow-hidden",
          "max-h-[min(90vh,900px)] max-w-[min(96vw,1200px)]",
        )}
        aria-describedby={undefined}
      >
        {surfaceContent}
      </DialogContent>
    </Dialog>
  )
}

function LoadedState({
  file,
  publishing,
  onPublish,
  closeAction,
}: {
  file: SelectedFile
  publishing: boolean
  onPublish: (payload: PublishPayload) => void
  closeAction: React.ReactNode
}) {
  const isMobile = useIsMobile()
  const form = useForm({
    defaultValues: {
      title: stripExtension(file.name),
      description: "",
      game: null as GameRow | null,
      mentions: [] as UserSearchResult[],
      visibility: "unlisted" as Visibility,
    },
    onSubmit: async ({ value }) => {
      const title = normalizeClipTitle(value.title)
      if (!value.game || title.length === 0) return
      setCapturing(true)
      let thumbBlob: Blob
      try {
        const posterAtMs = Math.min(1000, Math.max(0, file.durationMs - 100))
        thumbBlob = await captureThumbnail(file.file, posterAtMs)
      } catch (err) {
        setCapturing(false)
        toast.error(errorMessage(err, "Could not capture thumbnail"))
        return
      } finally {
        setCapturing(false)
      }
      onPublish({
        file: file.file,
        contentType: file.contentType,
        title,
        description: nullableClipDescription(value.description),
        gameId: value.game.id,
        privacy: value.visibility,
        width: file.width,
        height: file.height,
        durationMs: file.durationMs,
        sizeBytes: file.sizeBytes,
        thumbBlob,
        mentionedUserIds: value.mentions.map((u) => u.id),
      })
    },
  })

  const [capturing, setCapturing] = React.useState(false)

  // Advisory ML game guess. Frames are captured once per staged file; include
  // the browser File timestamp so Replace does not reuse a stale query entry.
  const fileKey =
    `${file.name}:${file.sizeBytes}:${file.durationMs}:${file.file.lastModified}`
  const mlConfigQuery = useMlConfigQuery()
  const mlEnabled = mlConfigQuery.data?.enabled === true
  const [suggestionDismissed, setSuggestionDismissed] = React.useState(false)
  const suggestionQuery = useGameSuggestionQuery(
    file.file,
    fileKey,
    mlConfigQuery.data,
    { enabled: mlEnabled && !suggestionDismissed },
  )
  // Search the top prediction for preview art/name without upserting a game
  // row. Accepting the suggestion resolves and commits the row explicitly.
  const topLabel = suggestionQuery.data?.[0]?.label
  const previewQuery = useGamePreviewByNameQuery(topLabel, {
    enabled: mlEnabled && !suggestionDismissed,
  })
  const resolveGameMutation = useResolveGameMutation()
  const suggestedGame = previewQuery.data
  const suggestionAnalyzing = suggestionQuery.isLoading ||
    (Boolean(topLabel) && previewQuery.isLoading)

  const submitButton = (
    <form.Subscribe
      selector={(state) =>
        [
          state.canSubmit,
          state.isSubmitting,
          state.values.title,
          state.values.game,
        ] as const}
    >
      {([canSubmit, isSubmitting, titleValue, gameValue]) => {
        const missingMetadata = titleValue.trim().length === 0 || !gameValue
        return (
          <Button
            type="submit"
            variant="primary"
            size="default"
            disabled={publishing ||
              capturing ||
              isSubmitting ||
              !canSubmit ||
              missingMetadata}
            className={cn(isMobile && "w-full min-w-0")}
          >
            <UploadIcon />
            {capturing || isSubmitting
              ? "Preparing…"
              : publishing
              ? "Uploading…"
              : "Upload"}
          </Button>
        )
      }}
    </form.Subscribe>
  )

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <DialogBody
        className={cn(
          "flex-1 px-4 py-3 sm:px-6 sm:py-4",
          isMobile ? "overflow-y-scroll" : "overflow-y-auto",
          isMobile && "px-4",
          "grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]",
        )}
      >
        <section className="flex min-w-0 flex-col gap-3">
          <ClipPreview file={file} />
        </section>

        <section className="flex min-w-0 flex-col gap-4 lg:h-full">
          <form.Field
            name="game"
            validators={{
              onChange: ({ value }) => (value ? undefined : "Game is required"),
            }}
          >
            {(field) => {
              const invalid = form.state.submissionAttempts > 0 &&
                !field.state.meta.isValid

              // Only surface a guess while the field is still empty and the
              // user hasn't dismissed it. Accept commits the resolved game;
              // decline clears the field and steps aside.
              const showSuggestion = mlEnabled && !suggestionDismissed &&
                !field.state.value
              let suggestionNode: React.ReactNode = null
              if (showSuggestion && suggestionAnalyzing) {
                suggestionNode = (
                  <GameSuggestion
                    status="analyzing"
                    onAccept={() => {}}
                    onDecline={() => setSuggestionDismissed(true)}
                  />
                )
              } else if (showSuggestion && suggestedGame) {
                suggestionNode = (
                  <GameSuggestion
                    status="ready"
                    game={suggestedGame}
                    accepting={resolveGameMutation.isPending}
                    onAccept={() => {
                      resolveGameMutation.mutate(
                        { steamgriddbId: suggestedGame.id },
                        {
                          onSuccess: (game) => {
                            field.handleChange(game)
                            setSuggestionDismissed(true)
                          },
                          onError: (error) => {
                            toast.error(
                              errorMessage(error, "Could not use suggestion"),
                            )
                          },
                        },
                      )
                    }}
                    onDecline={() => {
                      field.handleChange(null)
                      setSuggestionDismissed(true)
                    }}
                  />
                )
              }

              return (
                <Field>
                  <FieldLabel htmlFor="clip-game" required>
                    Game
                  </FieldLabel>
                  <GameCombobox
                    id="clip-game"
                    value={field.state.value}
                    onChange={field.handleChange}
                    disabled={publishing || capturing}
                    placeholder="Search SteamGridDB…"
                    invalid={invalid}
                    required
                    suggestion={suggestionNode}
                  />
                </Field>
              )
            }}
          </form.Field>

          <form.Field
            name="title"
            validators={{
              onChange: ({ value }) =>
                validateRequiredString(value, "Title") ??
                  (value.trim().length > CLIP_TITLE_MAX
                    ? `Title can be at most ${CLIP_TITLE_MAX} characters`
                    : undefined),
            }}
          >
            {(field) => {
              const invalid = form.state.submissionAttempts > 0 &&
                !field.state.meta.isValid
              return (
                <Field>
                  <FieldLabel htmlFor="clip-title" required>
                    Title
                  </FieldLabel>
                  <LimitedInput
                    id="clip-title"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    maxLength={CLIP_TITLE_MAX}
                    aria-invalid={invalid || undefined}
                    aria-required
                  />
                </Field>
              )
            }}
          </form.Field>

          <form.Field name="description">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="clip-description">Description</FieldLabel>
                <LimitedTextarea
                  id="clip-description"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  rows={3}
                  maxLength={CLIP_DESCRIPTION_MAX}
                  placeholder="Add context"
                  className="min-h-0 px-3 py-2 text-base sm:text-sm"
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="mentions">
            {(field) => (
              <Field>
                <FieldLabel>Tag users</FieldLabel>
                <MentionPicker
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="visibility">
            {(field) => (
              <Field>
                <FieldLabel>Visibility</FieldLabel>
                <ClipPrivacyPicker
                  value={field.state.value}
                  onChange={field.handleChange}
                  disabled={publishing || capturing}
                />
              </Field>
            )}
          </form.Field>

          {
            /* Desktop actions live at the bottom of the form column so they
              align with the video's bottom edge — no empty footer band. */
          }
          {!isMobile
            ? (
              <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-2">
                {closeAction}
                {submitButton}
              </div>
            )
            : null}
        </section>
      </DialogBody>

      {isMobile
        ? (
          <DialogFooter className="grid shrink-0 grid-cols-2 gap-2 px-4 pt-3 pb-5">
            {closeAction}
            {submitButton}
          </DialogFooter>
        )
        : null}
    </form>
  )
}

function ClipPreview({ file }: { file: SelectedFile }) {
  return (
    // Keep upload previews square-edged; Chromium can paint promoted video
    // layers past rounded ancestors.
    <div className="aspect-video">
      <VideoPlayer
        src={file.file}
        controls
        autoPlay
        muted
        className="h-full w-full"
      />
    </div>
  )
}
