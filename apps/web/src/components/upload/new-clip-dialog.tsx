import * as React from "react"
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
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"

import { CLIP_DESCRIPTION_MAX, CLIP_TITLE_MAX } from "@/lib/clip-fields"
import type { GameRow, UserSearchResult } from "@workspace/api"

import { ClipPrivacyPicker } from "@/components/clip/clip-privacy-picker"
import { LimitedInput, LimitedTextarea } from "@/components/form/limited-field"
import { GameCombobox } from "@/components/game/game-combobox"
import { MentionPicker } from "@/components/search/mention-picker"
import {
  ACCEPT_LIST,
  captureThumbnail,
  formatTimecode,
  probeFile,
  resolveContentType,
  stripExtension,
  type PublishPayload,
  type SelectedFile,
  type Visibility,
} from "./new-clip-helpers"
import { TrimTimeline, VideoPreview } from "./upload-trim-preview"

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
        <div className="shrink-0 px-4 pt-2 pb-4">
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
                  variant="outline"
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
                    variant="outline"
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
          className="max-h-[85vh] bg-surface"
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
  const [title, setTitle] = React.useState(stripExtension(file.name))
  const [description, setDescription] = React.useState("")
  const [game, setGame] = React.useState<GameRow | null>(null)
  const [mentions, setMentions] = React.useState<Array<UserSearchResult>>([])
  const [visibility, setVisibility] = React.useState<Visibility>("unlisted")

  // Trim window in ms against the source. Initial range = full clip; we
  // only emit the trim columns to the server when the user narrowed it.
  const [trimStartMs, setTrimStartMs] = React.useState(0)
  const [trimEndMs, setTrimEndMs] = React.useState(file.durationMs)
  const [currentMs, setCurrentMs] = React.useState(0)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [volume, setVolume] = React.useState(1)
  const [muted, setMuted] = React.useState(false)

  const trimChanged = trimStartMs > 0 || trimEndMs < file.durationMs

  const [capturing, setCapturing] = React.useState(false)
  const [submissionAttempts, setSubmissionAttempts] = React.useState(0)

  const hasTitle = title.trim().length > 0
  const hasGame = game !== null
  const canPublish = hasTitle && hasGame && trimEndMs > trimStartMs
  const titleInvalid = submissionAttempts > 0 && !hasTitle
  const gameInvalid = submissionAttempts > 0 && !hasGame

  const handlePublishClick = async () => {
    const trimmedTitle = title.trim()
    const missingTitle = !hasTitle
    const missingGame = !game

    setSubmissionAttempts((attempts) => attempts + 1)

    if (missingTitle || missingGame) return
    if (trimEndMs <= trimStartMs) return
    setCapturing(true)
    let thumbBlob: Blob
    try {
      const posterAtMs = Math.min(
        trimStartMs + 1000,
        Math.max(trimStartMs, trimEndMs - 100)
      )
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
      title: trimmedTitle,
      description: description.trim() || null,
      gameId: game.id,
      privacy: visibility,
      width: file.width,
      height: file.height,
      durationMs: trimChanged ? trimEndMs - trimStartMs : file.durationMs,
      sizeBytes: file.sizeBytes,
      trimStartMs: trimChanged ? trimStartMs : null,
      trimEndMs: trimChanged ? trimEndMs : null,
      thumbBlob,
      mentionedUserIds: mentions.map((u) => u.id),
    })
  }

  return (
    <>
      <DialogBody
        className={cn(
          "flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4",
          isMobile && "px-4",
          "grid gap-6",
          "grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)]"
        )}
      >
        {/* Left column — trim / player */}
        <section className="flex min-w-0 flex-col gap-3">
          <Label>Trim</Label>

          <VideoPreview
            file={file.file}
            trimStartMs={trimStartMs}
            trimEndMs={trimEndMs}
            isPlaying={isPlaying}
            currentMs={currentMs}
            volume={volume}
            muted={muted}
            onTimeUpdate={setCurrentMs}
            onPlayingChange={setIsPlaying}
            onVolumeChange={setVolume}
            onToggleMute={() => setMuted((m) => !m)}
          />

          <TrimTimeline
            file={file.file}
            durationMs={file.durationMs}
            trimStartMs={trimStartMs}
            trimEndMs={trimEndMs}
            currentMs={currentMs}
            onTrimChange={(start, end) => {
              setTrimStartMs(start)
              setTrimEndMs(end)
              // Clamp the playhead into the new window so it doesn't sit
              // off-range when the user drags the start past it.
              setCurrentMs((prev) => Math.min(Math.max(prev, start), end))
            }}
            onSeek={(ms) => setCurrentMs(ms)}
          >
            <div className="flex items-center gap-4 text-xs text-foreground-muted tabular-nums">
              <span>
                <span className="text-foreground-faint">In</span>{" "}
                <span className="font-semibold text-foreground">
                  {formatTimecode(trimStartMs)}
                </span>
              </span>
              <span className="font-semibold text-foreground">
                {formatTimecode(trimEndMs - trimStartMs)}
                {trimChanged ? (
                  <span className="ml-1.5 font-medium text-accent">
                    trimmed
                  </span>
                ) : null}
              </span>
              <span>
                <span className="text-foreground-faint">Out</span>{" "}
                <span className="font-semibold text-foreground">
                  {formatTimecode(trimEndMs)}
                </span>
              </span>
            </div>
          </TrimTimeline>
        </section>

        {/* Right column — metadata form */}
        <section className="flex min-w-0 flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="clip-game" required>
              Game
            </FieldLabel>
            <GameCombobox
              id="clip-game"
              value={game}
              onChange={setGame}
              disabled={publishing || capturing}
              placeholder="Search SteamGridDB…"
              invalid={gameInvalid}
              required
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="clip-title" required>
              Title
            </FieldLabel>
            <LimitedInput
              id="clip-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={CLIP_TITLE_MAX}
              aria-invalid={titleInvalid || undefined}
              aria-required={true}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="clip-description">Description</FieldLabel>
            <LimitedTextarea
              id="clip-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={CLIP_DESCRIPTION_MAX}
              placeholder="Add context"
              className="min-h-0 px-3 py-2 text-sm"
            />
          </Field>

          <Field>
            <FieldLabel>Tag users</FieldLabel>
            <MentionPicker value={mentions} onChange={setMentions} />
          </Field>

          <Field>
            <FieldLabel>Visibility</FieldLabel>
            <ClipPrivacyPicker
              value={visibility}
              onChange={setVisibility}
              disabled={publishing || capturing}
            />
          </Field>
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
          variant="secondary"
          size="default"
          disabled={publishing}
          onClick={onReplace}
          className={cn(isMobile && "w-full min-w-0")}
        >
          Replace
        </Button>
        {closeAction}
        <Button
          variant="primary"
          size="default"
          disabled={publishing || capturing || !canPublish}
          onClick={handlePublishClick}
          className={cn(isMobile && "w-full min-w-0")}
        >
          {capturing ? "Preparing…" : publishing ? "Uploading…" : "Upload clip"}
        </Button>
      </DialogFooter>
    </>
  )
}
