import * as React from "react"
import { useForm } from "@tanstack/react-form"
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

import { CLIP_DESCRIPTION_MAX, CLIP_TITLE_MAX } from "@/lib/clip-fields"
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
import { useMlConfigQuery } from "@/lib/ml-queries"
import { useGameSuggestionQuery } from "./use-game-suggestion"
import {
  ACCEPT_LIST,
  captureThumbnail,
  probeFile,
  resolveContentType,
  stripExtension,
  type PublishPayload,
  type SelectedFile,
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
  // File input kept for the Replace button in LoadedState.
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = React.useState<SelectedFile | null>(
    null
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

  // Called by the Replace button — let the user swap the file in-place
  // without leaving the modal.
  const handleFileChosen = React.useCallback(async (file: File) => {
    const contentType = resolveContentType(file)
    if (!contentType) {
      toast.error("Unsupported file type")
      return
    }
    try {
      const meta = await probeFile(file)
      setSelectedFile({ ...meta, contentType })
    } catch {
      toast.error("Couldn't read video metadata")
    }
  }, [])

  const handleReplaceClick = React.useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleInputChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      // Reset immediately so re-selecting the same file still fires `change`.
      e.target.value = ""
      if (!file) return
      requestAnimationFrame(() => {
        void handleFileChosen(file)
      })
    },
    [handleFileChosen]
  )

  const handlePublish = React.useCallback(
    async (payload: PublishPayload) => {
      setPublishing(true)
      try {
        await onPublish(payload)
      } catch {
        toast.error("Couldn't publish clip")
      } finally {
        setPublishing(false)
      }
    },
    [onPublish]
  )

  // Use the initial file as a synchronous fallback so the modal renders
  // LoadedState immediately on first open without waiting for the effect.
  const activeFile = selectedFile ?? (open ? (initialFile ?? null) : null)
  const activeFileKey = activeFile
    ? `${activeFile.name}:${activeFile.sizeBytes}:${activeFile.durationMs}`
    : null

  const surfaceContent = (
    <>
      {/* Hidden input used only for the Replace button in LoadedState. */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_LIST}
        className="hidden"
        onChange={handleInputChange}
      />
      {isMobile ? (
        <div className="shrink-0 px-4 pt-4 pb-4">
          <DrawerTitle className="text-lg leading-tight font-semibold tracking-[var(--tracking-tight)] text-foreground">
            New clip
          </DrawerTitle>
        </div>
      ) : (
        <DialogHeader className="shrink-0">
          <DialogTitle>New clip</DialogTitle>
        </DialogHeader>
      )}

      {activeFile ? (
        <LoadedState
          key={activeFileKey}
          file={activeFile}
          publishing={publishing}
          onPublish={handlePublish}
          onReplace={handleReplaceClick}
          closeAction={
            isMobile ? (
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
            ) : (
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
            )
          }
        />
      ) : null}
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
          "max-h-[min(90vh,900px)] max-w-[min(96vw,1200px)]"
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
  onReplace,
  closeAction,
}: {
  file: SelectedFile
  publishing: boolean
  onPublish: (payload: PublishPayload) => void
  onReplace: () => void
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
      if (!value.game || value.title.trim().length === 0) return
      setCapturing(true)
      let thumbBlob: Blob
      try {
        const posterAtMs = Math.min(1000, Math.max(0, file.durationMs - 100))
        thumbBlob = await captureThumbnail(file.file, posterAtMs)
      } catch (err) {
        setCapturing(false)
        toast.error(
          err instanceof Error ? err.message : "Could not capture thumbnail"
        )
        return
      } finally {
        setCapturing(false)
      }
      onPublish({
        file: file.file,
        contentType: file.contentType,
        title: value.title.trim(),
        description: value.description.trim() || null,
        gameId: value.game.id,
        privacy: value.visibility,
        width: file.width,
        height: file.height,
        durationMs: file.durationMs,
        sizeBytes: file.sizeBytes,
        trimStartMs: null,
        trimEndMs: null,
        thumbBlob,
        mentionedUserIds: value.mentions.map((u) => u.id),
      })
    },
  })

  const [capturing, setCapturing] = React.useState(false)

  // Advisory ML game guess. Frames are captured once per staged file; the
  // surrounding LoadedState is keyed by file, so this all resets on Replace.
  const fileKey = `${file.name}:${file.sizeBytes}:${file.durationMs}`
  const mlConfigQuery = useMlConfigQuery()
  const mlEnabled = mlConfigQuery.data?.enabled === true
  const [suggestionDismissed, setSuggestionDismissed] = React.useState(false)
  const suggestionQuery = useGameSuggestionQuery(
    file.file,
    fileKey,
    mlConfigQuery.data,
    { enabled: mlEnabled && !suggestionDismissed }
  )
  // Search the top prediction for preview art/name without upserting a game
  // row. Accepting the suggestion resolves and commits the row explicitly.
  const topLabel = suggestionQuery.data?.[0]?.label
  const previewQuery = useGamePreviewByNameQuery(topLabel, {
    enabled: mlEnabled && !suggestionDismissed,
  })
  const resolveGameMutation = useResolveGameMutation()
  const suggestedGame = previewQuery.data
  const suggestionAnalyzing =
    suggestionQuery.isLoading || (Boolean(topLabel) && previewQuery.isLoading)

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
          "grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]"
        )}
      >
        <section className="flex min-w-0 flex-col gap-3">
          <ClipPreview file={file} />
        </section>

        <section className="flex min-w-0 flex-col gap-4">
          <form.Field
            name="game"
            validators={{
              onChange: ({ value }) => (value ? undefined : "Game is required"),
            }}
          >
            {(field) => {
              const invalid =
                form.state.submissionAttempts > 0 && !field.state.meta.isValid

              // Only surface a guess while the field is still empty and the
              // user hasn't dismissed it. Accept commits the resolved game;
              // decline clears the field and steps aside.
              const showSuggestion =
                mlEnabled && !suggestionDismissed && !field.state.value
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
                              error.message || "Could not use suggestion"
                            )
                          },
                        }
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
              const invalid =
                form.state.submissionAttempts > 0 && !field.state.meta.isValid
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
                    aria-required={true}
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
                  className="min-h-0 px-3 py-2 text-sm"
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
        </section>
      </DialogBody>

      <DialogFooter
        className={cn(
          "shrink-0 flex-wrap pt-3 sm:pt-4",
          isMobile
            ? "grid grid-cols-3 gap-2 px-4 pb-5"
            : "pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        )}
      >
        <Button
          variant="ghost"
          size="default"
          disabled={publishing}
          onClick={onReplace}
          className={cn(isMobile && "w-full min-w-0")}
        >
          Replace
        </Button>
        {closeAction}
        <form.Subscribe
          selector={(state) =>
            [
              state.canSubmit,
              state.isSubmitting,
              state.values.title,
              state.values.game,
            ] as const
          }
        >
          {([canSubmit, isSubmitting, titleValue, gameValue]) => {
            const missingMetadata = titleValue.trim().length === 0 || !gameValue
            return (
              <Button
                type="submit"
                variant="primary"
                size="default"
                disabled={
                  publishing ||
                  capturing ||
                  isSubmitting ||
                  !canSubmit ||
                  missingMetadata
                }
                className={cn(isMobile && "w-full min-w-0")}
              >
                {capturing || isSubmitting
                  ? "Preparing…"
                  : publishing
                    ? "Uploading…"
                    : "Upload clip"}
              </Button>
            )
          }}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}

function ClipPreview({ file }: { file: SelectedFile }) {
  return (
    <div className="aspect-video overflow-hidden rounded-lg bg-surface-sunken shadow-[inset_0_1px_0_oklch(1_0_0_/_0.035)]">
      <VideoPlayer src={file.file} controls autoPlay muted className="h-full" />
    </div>
  )
}
