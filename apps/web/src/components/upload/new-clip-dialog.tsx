import * as React from "react"
import {
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SkipBackIcon,
  SkipForwardIcon,
  UploadIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/components/sonner"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { useIsMobile } from "@workspace/ui/hooks/use-mobile"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

import { CLIP_DESCRIPTION_MAX, CLIP_TITLE_MAX } from "@/lib/clip-fields"
import type { GameRow } from "@/lib/games-api"
import type { UserSearchResult } from "@/lib/users-api"

import { ClipPrivacyPicker } from "@/components/clip/clip-privacy-picker"
import { GameCombobox } from "@/components/game/game-combobox"
import { MentionPicker } from "@/components/search/mention-picker"
import { VolumeControl } from "@/components/video/video-player"
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
import { SpeedButton, TrimTimeline, VideoPreview } from "./upload-trim-preview"

// Re-export public API consumed by upload-flow.tsx so the import surface
// stays stable across the split.
export { ACCEPT_LIST, probeFile, resolveContentType } from "./new-clip-helpers"
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
      toast.error("Unsupported file type", {
        description:
          file.type || file.name.split(".").pop()?.toLowerCase() || "unknown",
      })
      return
    }
    try {
      const meta = await probeFile(file)
      setSelectedFile({ ...meta, contentType })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to read file"
      toast.error("Couldn't read video metadata", { description: message })
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
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to upload clip"
        toast.error("Couldn't publish clip", { description: message })
      } finally {
        setPublishing(false)
      }
    },
    [onPublish]
  )

  // Use the initial file as a synchronous fallback so the modal renders
  // LoadedState immediately on first open without waiting for the effect.
  const activeFile = selectedFile ?? (open ? (initialFile ?? null) : null)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={handleOpenChangeComplete}
    >
      <DialogContent
        disableZoom
        centered={!isMobile}
        className={cn(
          "flex flex-col overflow-hidden",
          isMobile
            ? "top-auto right-4 bottom-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom)+1rem)] left-4 max-h-[calc(100dvh-var(--header-h)-var(--bottomnav-h)-env(safe-area-inset-bottom)-2.5rem)] w-auto max-w-none rounded-xl"
            : "max-h-[min(94vh,900px)] max-w-[960px]"
        )}
        aria-describedby={undefined}
      >
        {/* Hidden input used only for the Replace button in LoadedState. */}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_LIST}
          className="hidden"
          onChange={handleInputChange}
        />
        <DialogHeader className="shrink-0 border-b border-border/60 pb-3">
          <DialogTitle>New clip</DialogTitle>
        </DialogHeader>

        {activeFile ? (
          <LoadedState
            file={activeFile}
            publishing={publishing}
            onPublish={handlePublish}
            onReplace={handleReplaceClick}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function LoadedState({
  file,
  publishing,
  onPublish,
  onReplace,
}: {
  file: SelectedFile
  publishing: boolean
  onPublish: (payload: PublishPayload) => void
  onReplace: () => void
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
  const [playbackRate, setPlaybackRate] = React.useState<0.5 | 1 | 2>(1)
  const [volume, setVolume] = React.useState(1)
  const [muted, setMuted] = React.useState(false)

  const trimChanged = trimStartMs > 0 || trimEndMs < file.durationMs

  const [capturing, setCapturing] = React.useState(false)
  const [submissionAttempts, setSubmissionAttempts] = React.useState(0)

  const titleInvalid = submissionAttempts > 0 && title.trim().length === 0
  const gameInvalid = submissionAttempts > 0 && game === null

  const handlePublishClick = async () => {
    const trimmedTitle = title.trim()
    const missingTitle = trimmedTitle.length === 0
    const missingGame = game === null

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
      throw err instanceof Error
        ? err
        : new Error("Could not capture thumbnail")
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
          "flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5",
          "grid gap-6",
          "grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)]"
        )}
      >
        {/* Left column — trim / player */}
        <section className="flex min-w-0 flex-col gap-3">
          <Label>Trim</Label>

          <VideoPreview
            file={file.file}
            durationMs={file.durationMs}
            trimStartMs={trimStartMs}
            trimEndMs={trimEndMs}
            playbackRate={playbackRate}
            isPlaying={isPlaying}
            currentMs={currentMs}
            volume={volume}
            muted={muted}
            onTimeUpdate={setCurrentMs}
            onPlayingChange={setIsPlaying}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Jump to trim start"
              onClick={() => setCurrentMs(trimStartMs)}
            >
              <SkipBackIcon />
            </Button>
            <Button
              variant="primary"
              size="icon-sm"
              aria-label={isPlaying ? "Pause" : "Play"}
              onClick={() => setIsPlaying((p) => !p)}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Jump to trim end"
              onClick={() =>
                setCurrentMs(Math.max(trimStartMs, trimEndMs - 100))
              }
            >
              <SkipForwardIcon />
            </Button>
            <span className="ml-2 text-xs font-semibold text-foreground-muted tabular-nums">
              {formatTimecode(currentMs)}{" "}
              <span className="text-foreground-muted">/</span>{" "}
              {formatTimecode(file.durationMs)}
            </span>

            <VolumeControl
              className="ml-auto"
              volume={volume}
              muted={muted}
              onVolumeChange={setVolume}
              onToggleMute={() => setMuted((m) => !m)}
            />

            <div className="flex items-center gap-1 rounded-md border border-border bg-surface-raised p-0.5">
              <SpeedButton
                active={playbackRate === 0.5}
                onClick={() => setPlaybackRate(0.5)}
              >
                ½×
              </SpeedButton>
              <SpeedButton
                active={playbackRate === 1}
                onClick={() => setPlaybackRate(1)}
              >
                1×
              </SpeedButton>
              <SpeedButton
                active={playbackRate === 2}
                onClick={() => setPlaybackRate(2)}
              >
                2×
              </SpeedButton>
            </div>
          </div>

          <TrimTimeline
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
          />

          <div className="flex items-center justify-between text-xs font-semibold text-foreground-muted tabular-nums">
            <span>In {formatTimecode(trimStartMs)}</span>
            <span>
              Length {formatTimecode(trimEndMs - trimStartMs)}
              {trimChanged ? (
                <span className="ml-1.5 text-accent">· trimmed</span>
              ) : null}
            </span>
            <span>Out {formatTimecode(trimEndMs)}</span>
          </div>
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
            <Input
              id="clip-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={CLIP_TITLE_MAX}
              aria-invalid={titleInvalid || undefined}
              aria-required={true}
            />
            <div className="mt-1 text-right text-xs font-semibold text-foreground-muted tabular-nums">
              {title.length}/{CLIP_TITLE_MAX}
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="clip-description">Description</FieldLabel>
            <Textarea
              id="clip-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={CLIP_DESCRIPTION_MAX}
              placeholder="Add context"
              className="min-h-0 rounded-md px-3 py-2 text-sm"
            />
          </Field>

          <Field>
            <FieldLabel>Tag users</FieldLabel>
            <MentionPicker value={mentions} onChange={setMentions} />
          </Field>

          <Field>
            <FieldLabel>Visibility</FieldLabel>
            <ClipPrivacyPicker value={visibility} onChange={setVisibility} />
          </Field>
        </section>
      </DialogBody>

      <DialogFooter
        className={cn(
          "shrink-0 flex-wrap border-t border-border/60 bg-surface pt-3 sm:pt-4",
          isMobile ? "pb-5" : "pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        )}
      >
        <Button
          variant="ghost"
          size="default"
          disabled={publishing}
          onClick={onReplace}
        >
          <RotateCcwIcon />
          Replace
        </Button>
        <DialogClose
          render={
            <Button variant="ghost" size="default" disabled={publishing} />
          }
        >
          Cancel
        </DialogClose>
        <Button
          variant="primary"
          size="default"
          disabled={publishing || capturing}
          onClick={handlePublishClick}
        >
          <UploadIcon />
          {capturing ? "Preparing…" : publishing ? "Uploading…" : "Upload clip"}
        </Button>
      </DialogFooter>
    </>
  )
}
