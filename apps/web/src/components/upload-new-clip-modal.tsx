import * as React from "react";
import {
  FolderOpenIcon,
  GlobeIcon,
  Link2Icon,
  LockIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SkipBackIcon,
  SkipForwardIcon,
  UploadIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { cn } from "@workspace/ui/lib/utils";

import { VideoPlayer, VolumeControl } from "./video-player";

/**
 * Upload modal for a single new clip. Owns the file selection (file
 * input + drag-drop), the client-side metadata probe via a hidden
 * `<video>`, and the metadata form. The actual upload runs in
 * `upload-flow.tsx` via the `onPublish` callback — this component closes
 * itself once Publish is hit and the parent handles the
 * initiate→upload→finalize state machine.
 *
 * Why probe in the browser: we want the queue row to start showing the
 * right resolution/duration *before* the file leaves the user's machine.
 * The probe is just `URL.createObjectURL` → hidden `<video>` →
 * `loadedmetadata` — no extra deps.
 */

/** Metadata derived from a real File for display in the modal header. */
export interface SelectedFile {
  /** The actual File the parent will upload. */
  file: File;
  name: string;
  size: string;
  resolution: string;
  fps: string;
  duration: string;
  /** ms — for the server's `/initiate` body and the trim UI. */
  durationMs: number;
  width: number;
  height: number;
  sizeBytes: number;
}

export type Visibility = "public" | "unlisted" | "friends" | "private";

export interface PublishPayload {
  file: File;
  title: string;
  description: string | null;
  game: string | null;
  /**
   * Server-supported privacy. The modal still exposes "friends" but the
   * parent coerces it to "private" until the follow-graph join lands —
   * see the cut line in the implementation plan.
   */
  privacy: "public" | "unlisted" | "private";
  /** Pre-coercion visibility, kept around in case the parent wants it. */
  rawVisibility: Visibility;
  width: number;
  height: number;
  durationMs: number;
  sizeBytes: number;
  /**
   * Trim window in ms against the source. Both set together when the
   * user narrowed the range; both null when the full source should
   * encode. The modal only emits these when the range differs from the
   * full extent (so an untouched timeline doesn't waste a column write).
   */
  trimStartMs: number | null;
  trimEndMs: number | null;
  /**
   * Client-captured thumbnails. Both are required — publishing fails if
   * the canvas couldn't produce them (e.g. tainted source). The 640px
   * variant is the poster; the 160px variant is the grid/card thumb.
   * Both are JPEG blobs ready to PUT at the storage tickets the server
   * hands back from /initiate.
   */
  thumbBlob: Blob;
  thumbSmallBlob: Blob;
}

interface UploadNewClipModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Fired when the user hits Publish. The parent is responsible for
   * closing the modal (or it stays open while `publishing` is true if
   * the parent wants to keep it visible). Throwing surfaces an error
   * back into the modal's internal state.
   */
  onPublish: (payload: PublishPayload) => Promise<void> | void;
  /**
   * When true the dialog skips its built-in overlay — the parent
   * (`upload-flow.tsx`) renders a single shared backdrop across both
   * upload modals so the handoff doesn't flash.
   */
  sharedOverlay?: boolean;
}

// File picker MIME types — match the server's ACCEPTED_CONTENT_TYPES.
const ACCEPT_LIST = "video/mp4,video/quicktime,video/x-matroska,video/webm";

export function UploadNewClipModal({
  open,
  onOpenChange,
  onPublish,
  sharedOverlay = false,
}: UploadNewClipModalProps) {
  const [selectedFile, setSelectedFile] = React.useState<SelectedFile | null>(
    null,
  );
  const [probeError, setProbeError] = React.useState<string | null>(null);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [publishing, setPublishing] = React.useState(false);

  // Reset everything *after* the close animation finishes — otherwise a
  // second open would still hold the previous file. Doing this from a
  // `useEffect([open])` fires synchronously with the close animation,
  // which flips `hasFile` mid-transition: the panel's `max-width` snaps
  // from 960 → 640, the inner `key` swap tears down the loaded subtree
  // and plays a fresh `fade-in-0` on the empty state, and the header
  // drops its file badges. All of that bleeds through the dialog's
  // ~100ms fade/zoom-out and reads as a flash. `onOpenChangeComplete`
  // fires once the popup has finished animating, so the reset is
  // invisible.
  const handleOpenChangeComplete = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedFile(null);
      setProbeError(null);
      setPublishError(null);
      setPublishing(false);
    }
  }, []);

  const handleFileChosen = React.useCallback(async (file: File) => {
    setProbeError(null);
    setPublishError(null);
    if (!ACCEPT_LIST.split(",").includes(file.type)) {
      setProbeError(`Unsupported file type: ${file.type || "unknown"}`);
      return;
    }
    try {
      const meta = await probeFile(file);
      setSelectedFile(meta);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to read file";
      setProbeError(message);
    }
  }, []);

  const handleClearFile = React.useCallback(() => {
    setSelectedFile(null);
    setProbeError(null);
    setPublishError(null);
  }, []);

  const handlePublish = React.useCallback(
    async (payload: PublishPayload) => {
      setPublishing(true);
      setPublishError(null);
      try {
        await onPublish(payload);
        // Parent will typically close the modal; if not, reset for the
        // next clip.
        setSelectedFile(null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to upload clip";
        setPublishError(message);
      } finally {
        setPublishing(false);
      }
    },
    [onPublish],
  );

  const hasFile = selectedFile !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={handleOpenChangeComplete}
    >
      <DialogContent
        showCloseButton={false}
        showOverlay={!sharedOverlay}
        // Snap the panel width when the file lands rather than animating
        // it. The previous `transition-[max-width]` paired with an inner
        // remount that played `fade-in-0` for the same slow duration —
        // during that window the panel was visibly shorter (loaded
        // content fades in from opacity 0) which read as the backdrop
        // flashing through. Snap + no inner remount = the body content
        // swaps in place, panel grows to its new natural width, no
        // intermediate empty frame.
        className={hasFile ? "max-w-[960px]" : "max-w-[640px]"}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>New clip</DialogTitle>
        </DialogHeader>

        {selectedFile ? (
          <LoadedState
            file={selectedFile}
            publishing={publishing}
            publishError={publishError}
            onPublish={handlePublish}
            onReplace={handleClearFile}
          />
        ) : (
          <EmptyState
            probeError={probeError}
            onFileChosen={handleFileChosen}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({
  probeError,
  onFileChosen,
}: {
  probeError: string | null;
  onFileChosen: (file: File) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const handleClick = () => inputRef.current?.click();

  return (
    <>
      <DialogBody className="px-6 py-5">
        <button
          type="button"
          onClick={handleClick}
          // Drag-and-drop. preventDefault() on dragover is the key step
          // — without it the browser refuses to fire the drop event.
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) onFileChosen(file);
          }}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-4 rounded-lg",
            "border border-dashed border-border bg-surface-sunken",
            "px-6 py-12 text-center transition-colors",
            "duration-[var(--duration-fast)] ease-[var(--ease-out)]",
            "hover:border-accent-border hover:bg-surface-raised",
            "focus-visible:border-accent-border focus-visible:bg-surface-raised focus-visible:outline-none",
            dragOver && "border-accent-border bg-surface-raised",
          )}
        >
          <div
            aria-hidden
            className={cn(
              "flex size-14 items-center justify-center rounded-md",
              "border border-border bg-surface-raised text-foreground-muted",
            )}
          >
            <UploadIcon className="size-5" />
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <h3 className="text-lg font-semibold tracking-[-0.015em] text-foreground">
              Drag a video here
            </h3>
          </div>

          <div className="mt-1 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground",
              )}
            >
              <FolderOpenIcon className="size-4" />
              Choose file
            </span>
          </div>

          {probeError ? (
            <p className="font-mono text-xs text-destructive">{probeError}</p>
          ) : null}
        </button>

        {/* Hidden file input the dropzone forwards clicks to. */}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_LIST}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileChosen(file);
            // Reset so re-selecting the same file still fires onChange.
            e.target.value = "";
          }}
        />
      </DialogBody>

      <DialogFooter>
        <p className="mr-auto text-xs text-foreground-faint">
          Alloy reads metadata in the browser — your file only uploads after you
          hit Publish.
        </p>
        <DialogClose render={<Button variant="ghost" size="sm" />}>
          Cancel
        </DialogClose>
      </DialogFooter>
    </>
  );
}

function LoadedState({
  file,
  publishing,
  publishError,
  onPublish,
  onReplace,
}: {
  file: SelectedFile;
  publishing: boolean;
  publishError: string | null;
  onPublish: (payload: PublishPayload) => void;
  onReplace: () => void;
}) {
  const [title, setTitle] = React.useState(stripExtension(file.name));
  const [description, setDescription] = React.useState("");
  const [game, setGame] = React.useState<string>("");
  const [tags, setTags] = React.useState<Array<string>>([]);
  const [tagDraft, setTagDraft] = React.useState("");
  const [visibility, setVisibility] = React.useState<Visibility>("unlisted");

  // Trim window in ms against the source. Initial range = full clip; we
  // only emit the trim columns to the server when the user narrowed it.
  const [trimStartMs, setTrimStartMs] = React.useState(0);
  const [trimEndMs, setTrimEndMs] = React.useState(file.durationMs);
  const [currentMs, setCurrentMs] = React.useState(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [playbackRate, setPlaybackRate] = React.useState<0.5 | 1 | 2>(1);
  // Volume is 0–1 mirrored onto the <video> element. `muted` is tracked
  // separately so unmuting restores the prior level instead of jumping
  // to whatever the slider last sat at while muted.
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/^#/, "").toLowerCase();
    if (!tag) return;
    setTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
  };

  const trimChanged = trimStartMs > 0 || trimEndMs < file.durationMs;

  const [capturing, setCapturing] = React.useState(false);

  const handlePublishClick = async () => {
    if (!title.trim()) return;
    if (trimEndMs <= trimStartMs) return;
    setCapturing(true);
    let thumbs: { full: Blob; small: Blob };
    try {
      // Grab the poster frame one second into the trim window — matches
      // the server-side fallback's logic so client- and server-produced
      // posters look interchangeable.
      const posterAtMs = Math.min(
        trimStartMs + 1000,
        Math.max(trimStartMs, trimEndMs - 100),
      );
      thumbs = await captureThumbnails(file.file, posterAtMs);
    } catch (err) {
      setCapturing(false);
      throw err instanceof Error
        ? err
        : new Error("Could not capture thumbnail");
    } finally {
      setCapturing(false);
    }
    onPublish({
      file: file.file,
      title: title.trim(),
      description: description.trim() || null,
      game: game.trim() || null,
      // "friends" coerces to "private" until the follow graph joins are
      // wired into the read side. The plan calls this out explicitly.
      privacy: visibility === "friends" ? "private" : visibility,
      rawVisibility: visibility,
      width: file.width,
      height: file.height,
      // Reflect the trimmed length so the queue row shows the playable
      // duration, not the upload's. Server's encode worker writes the
      // same value back when it processes the trim.
      durationMs: trimChanged ? trimEndMs - trimStartMs : file.durationMs,
      sizeBytes: file.sizeBytes,
      trimStartMs: trimChanged ? trimStartMs : null,
      trimEndMs: trimChanged ? trimEndMs : null,
      thumbBlob: thumbs.full,
      thumbSmallBlob: thumbs.small,
    });
  };

  return (
    <>
      <DialogBody className="grid grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)] gap-6 px-6 py-5">
        {/* Left column — trim / player */}
        <section className="flex flex-col gap-3">
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

          <div className="flex items-center gap-2">
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
            <span className="ml-2 font-mono text-xs text-foreground-dim tabular-nums">
              {formatTimecode(currentMs)}{" "}
              <span className="text-foreground-faint">/</span>{" "}
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
              setTrimStartMs(start);
              setTrimEndMs(end);
              // Clamp the playhead into the new window so it doesn't sit
              // off-range when the user drags the start past it.
              setCurrentMs((prev) => Math.min(Math.max(prev, start), end));
            }}
            onSeek={(ms) => setCurrentMs(ms)}
          />

          <div className="flex items-center justify-between font-mono text-2xs text-foreground-faint tabular-nums">
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
        <section className="flex flex-col gap-4">
          <Field label="Game">
            <Input
              value={game}
              onChange={(e) => setGame(e.target.value)}
              placeholder="Optional"
              maxLength={120}
            />
          </Field>

          <Field
            label={
              <>
                Title
                <span className="text-accent"> · Required</span>
              </>
            }
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
            />
            <div className="mt-1 text-right font-mono text-2xs text-foreground-faint tabular-nums">
              {title.length}/100
            </div>
          </Field>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Add context — optional."
              className={cn(
                "w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground",
                "transition-[border-color,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                "placeholder:text-foreground-faint",
                "hover:border-border-strong",
                "focus-visible:border-accent-border focus-visible:bg-surface-raised focus-visible:outline-none",
              )}
            />
          </Field>

          <Field label="Tags">
            <div
              className={cn(
                "flex min-h-[30px] flex-wrap items-center gap-1.5 rounded-md border border-border bg-input px-2 py-1.5",
                "focus-within:border-accent-border focus-within:bg-surface-raised",
              )}
            >
              {tags.map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    "inline-flex h-5 items-center gap-1 rounded-sm bg-accent-soft px-1.5",
                    "font-mono text-2xs text-accent",
                  )}
                >
                  #{tag}
                  <button
                    type="button"
                    aria-label={`Remove #${tag}`}
                    onClick={() =>
                      setTags((prev) => prev.filter((t) => t !== tag))
                    }
                    className="text-accent/70 transition-colors hover:text-accent"
                  >
                    <XIcon className="size-3" />
                  </button>
                </span>
              ))}
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag(tagDraft);
                    setTagDraft("");
                  } else if (e.key === "Backspace" && tagDraft === "") {
                    setTags((prev) =>
                      prev.length > 0 ? prev.slice(0, -1) : prev,
                    );
                  }
                }}
                placeholder="add tag…"
                className={cn(
                  "min-w-[80px] flex-1 bg-transparent text-xs text-foreground",
                  "outline-none placeholder:text-foreground-faint",
                )}
              />
            </div>
          </Field>

          <Field label="Visibility">
            <VisibilityPicker value={visibility} onChange={setVisibility} />
          </Field>
        </section>
      </DialogBody>

      <DialogFooter>
        <span className="mr-auto font-mono text-2xs text-destructive">
          {publishError ?? ""}
        </span>
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
          disabled={publishing || capturing || !title.trim()}
          onClick={handlePublishClick}
        >
          <UploadIcon />
          {capturing
            ? "Preparing…"
            : publishing
              ? "Uploading…"
              : "Upload clip"}
        </Button>
      </DialogFooter>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const VISIBILITY_OPTIONS: Array<{
  value: Visibility;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "public", label: "Public", icon: GlobeIcon },
  { value: "unlisted", label: "Unlisted", icon: Link2Icon },
  { value: "friends", label: "Friends", icon: UsersIcon },
  { value: "private", label: "Private", icon: LockIcon },
];

function VisibilityPicker({
  value,
  onChange,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
}) {
  return (
    <div className="flex items-stretch rounded-md border border-border bg-input p-0.5">
      {VISIBILITY_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2",
              "h-[26px] text-xs transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              active
                ? "bg-surface-raised text-foreground"
                : "text-foreground-dim hover:text-foreground",
            )}
          >
            <Icon className="size-3" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SpeedButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-5 items-center justify-center rounded-sm px-1.5",
        "font-mono text-2xs transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-foreground-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Real `<video>` preview backed by an object URL on the chosen File.
 * Plays inside the trim window: when `currentMs` reaches `trimEndMs` we
 * either pause (no looping yet) or, on play press, jump back to
 * `trimStartMs` if the playhead is at/past the end.
 *
 * Time syncs both ways:
 *   • DOM `timeupdate` → `onTimeUpdate(ms)` (parent owns the playhead so
 *     the timeline can render it)
 *   • Parent's `currentMs` change → seeks the element if it drifted past
 *     a small epsilon (this is how scrubbing the timeline moves the
 *     player without setState ping-pong).
 *
 * The object URL is created/revoked per file — never reused across
 * remounts.
 */
function VideoPreview({
  file,
  durationMs,
  trimStartMs,
  trimEndMs,
  playbackRate,
  isPlaying,
  currentMs,
  volume,
  muted,
  onTimeUpdate,
  onPlayingChange,
}: {
  file: File;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  playbackRate: number;
  isPlaying: boolean;
  currentMs: number;
  volume: number;
  muted: boolean;
  onTimeUpdate: (ms: number) => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [src, setSrc] = React.useState<string | null>(null);

  // Mint the object URL when a file lands; revoke it on unmount or file
  // swap so we don't leak blob handles. Browsers eventually GC these but
  // explicit revoke keeps DevTools' memory tab honest.
  React.useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => {
      URL.revokeObjectURL(url);
      setSrc(null);
    };
  }, [file]);

  // Drive play/pause from the parent's `isPlaying`. We swallow the
  // `play()` rejection that fires when the element is paused before the
  // promise resolves — that's a normal race, not a real error.
  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      // If we're sitting at/past the trim end, rewind to the start so
      // the play button restarts the trim window instead of being a no-op.
      if (v.currentTime * 1000 >= trimEndMs - 30) {
        v.currentTime = trimStartMs / 1000;
      }
      v.play().catch(() => undefined);
    } else {
      v.pause();
    }
  }, [isPlaying, trimStartMs, trimEndMs]);

  // Mirror playbackRate onto the element. Cheap to apply unconditionally.
  React.useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = playbackRate;
  }, [playbackRate]);

  // Mirror volume + muted onto the element. Same shape as playbackRate
  // — single source of truth lives in parent state, the element just
  // reflects it.
  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted]);

  // Parent → element seek. Only nudge the element when the parent's
  // currentMs has moved meaningfully — otherwise our own `timeupdate`
  // handler would create a feedback loop (set state → effect fires →
  // seeks element → fires timeupdate → set state...).
  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const elementMs = v.currentTime * 1000;
    if (Math.abs(elementMs - currentMs) > 50) {
      v.currentTime = currentMs / 1000;
    }
  }, [currentMs]);

  return (
    <div className="relative">
      {src ? (
        // Bare `VideoPlayer` — the parent (this component) owns playback
        // state and drives the element through `videoRef`. We skip the
        // default `use-credentials` crossOrigin because the source is a
        // blob: URL minted from the File, not a fetch against the API.
        <VideoPlayer
          src={src}
          controls={false}
          videoRef={videoRef}
          crossOrigin="anonymous"
          onVideoClick={() => onPlayingChange(!isPlaying)}
          onPlayingChange={onPlayingChange}
          onTimeUpdate={(t) => {
            onTimeUpdate(t * 1000)
            // Stop at the trim end. Pause rather than loop so the user's
            // next interaction is scrubbing, not watching the window spin.
            if (t * 1000 >= trimEndMs && isPlaying) {
              videoRef.current?.pause()
              onPlayingChange(false)
            }
          }}
        />
      ) : (
        // Empty slot before the file URL resolves — keep the 16:9 so the
        // surrounding trim timeline doesn't jump when the player mounts.
        <div
          className={cn(
            "aspect-video overflow-hidden rounded-md",
            "border border-border bg-black",
          )}
        />
      )}

      <span
        className={cn(
          "pointer-events-none absolute bottom-2 left-2 inline-flex items-center rounded-sm bg-background/80 px-1.5 py-0.5",
          "font-mono text-2xs text-foreground-muted tabular-nums backdrop-blur-sm",
        )}
      >
        {formatTimecode(currentMs)}{" "}
        <span className="text-foreground-faint">/</span>{" "}
        {formatTimecode(durationMs)}
      </span>
    </div>
  );
}

/**
 * Real trim UI: a plain rail with two draggable handles flanking a
 * highlighted range, plus a playhead indicator. Click anywhere outside
 * the handles to seek.
 *
 * The drag state machine is plain pointer events (not the HTML drag-
 * and-drop API — that's for inter-element transfers, not for scrubbers).
 * `pointercapture` lets the handle keep receiving moves even when the
 * cursor leaves the element, which is the difference between a
 * scrubber that feels good and one that drops events the moment you
 * push the mouse.
 *
 * Minimum trim width is 100ms — anything smaller and the handles
 * overlap visually and the encoder'd produce a single-frame output.
 */
const MIN_TRIM_MS = 100;

function TrimTimeline({
  durationMs,
  trimStartMs,
  trimEndMs,
  currentMs,
  onTrimChange,
  onSeek,
}: {
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  currentMs: number;
  onTrimChange: (start: number, end: number) => void;
  onSeek: (ms: number) => void;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  // We need a ref alongside React state so the global pointermove
  // handler always reads the current trim values without re-attaching
  // listeners on every drag tick.
  const dragStateRef = React.useRef<{
    kind: "start" | "end" | "playhead";
    pointerId: number;
  } | null>(null);

  const pctOf = (ms: number) =>
    durationMs > 0 ? Math.min(100, Math.max(0, (ms / durationMs) * 100)) : 0;

  const msFromClient = React.useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
      const x = clientX - rect.left;
      const pct = Math.min(1, Math.max(0, x / rect.width));
      return Math.round(pct * durationMs);
    },
    [durationMs],
  );

  const startDrag = (
    kind: "start" | "end" | "playhead",
    e: React.PointerEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    dragStateRef.current = { kind, pointerId: e.pointerId };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const ms = msFromClient(e.clientX);
    if (drag.kind === "start") {
      const next = Math.min(ms, trimEndMs - MIN_TRIM_MS);
      onTrimChange(Math.max(0, next), trimEndMs);
    } else if (drag.kind === "end") {
      const next = Math.max(ms, trimStartMs + MIN_TRIM_MS);
      onTrimChange(trimStartMs, Math.min(durationMs, next));
    } else {
      // playhead: stay inside the trim window so the player doesn't
      // drift outside the soon-to-be-encoded range.
      onSeek(Math.min(Math.max(ms, trimStartMs), trimEndMs));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragStateRef.current = null;
  };

  // Click on the track (away from the handles) seeks the playhead.
  const handleTrackClick = (e: React.MouseEvent) => {
    if (dragStateRef.current) return;
    const ms = msFromClient(e.clientX);
    onSeek(Math.min(Math.max(ms, trimStartMs), trimEndMs));
  };

  return (
    <div
      ref={trackRef}
      onClick={handleTrackClick}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={cn(
        "relative h-10 w-full",
        "rounded-md border border-border bg-surface-sunken",
        // No `overflow-hidden`: the start handle is positioned with a
        // -8px margin so it straddles the 0% edge, and clipping it
        // chops off the left half. Fill rail and handles are already
        // rounded, so nothing else needs the clip.
        "select-none",
      )}
    >
      {/* Base rail — dim track spanning the full duration. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground-faint/20"
      />

      {/* Selected-range fill — accent rail inside the trim window. */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent"
        style={{
          left: `${pctOf(trimStartMs)}%`,
          right: `${100 - pctOf(trimEndMs)}%`,
        }}
      />

      {/* Start handle */}
      <button
        type="button"
        aria-label="Trim start"
        onPointerDown={(e) => startDrag("start", e)}
        className={cn(
          "absolute top-0 bottom-0 z-10 -ml-2 flex w-4 cursor-ew-resize items-center justify-center",
          "rounded-l-sm bg-accent text-accent-foreground",
          "hover:bg-accent-hover focus-visible:outline-none",
          "touch-none",
        )}
        style={{ left: `${pctOf(trimStartMs)}%` }}
      >
        <span className="h-4 w-[2px] rounded-full bg-accent-foreground/80" />
      </button>

      {/* End handle */}
      <button
        type="button"
        aria-label="Trim end"
        onPointerDown={(e) => startDrag("end", e)}
        className={cn(
          "absolute top-0 bottom-0 z-10 -mr-2 flex w-4 cursor-ew-resize items-center justify-center",
          "rounded-r-sm bg-accent text-accent-foreground",
          "hover:bg-accent-hover focus-visible:outline-none",
          "touch-none",
        )}
        style={{ left: `calc(${pctOf(trimEndMs)}% - 16px)` }}
      >
        <span className="h-4 w-[2px] rounded-full bg-accent-foreground/80" />
      </button>

      {/* Playhead — only render when it's inside the trim window so it
          doesn't visually escape the highlighted range */}
      {currentMs >= trimStartMs && currentMs <= trimEndMs ? (
        <button
          type="button"
          aria-label="Playhead — drag to scrub"
          onPointerDown={(e) => startDrag("playhead", e)}
          className={cn(
            "absolute top-0 bottom-0 z-20 -ml-[1px] w-[2px] cursor-ew-resize bg-foreground",
            "shadow-[0_0_0_1px_rgba(0,0,0,0.4)]",
            "touch-none focus-visible:outline-none",
          )}
          style={{ left: `${pctOf(currentMs)}%` }}
        />
      ) : null}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx > 0 ? filename.slice(0, idx) : filename;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * `M:SS.cs` for the trim/preview UI. Centiseconds give the user enough
 * precision to land on a specific moment without flooding the display.
 */
function formatTimecode(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const totalSec = Math.floor(safe / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const cs = Math.floor((safe % 1000) / 10);
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

/**
 * Grab two poster frames from a file at `atMs` — one 640px wide (the
 * player's poster / preview card) and one 160px wide (the grid/queue
 * thumb). We do both sizes from the same seeked frame to keep them
 * visually consistent and avoid a second seek round-trip.
 *
 * Canvas tainting isn't a concern here because the source is a local
 * File → blob URL (same-origin), but we still throw if `toBlob` returns
 * null (ancient browsers / OOM). The caller treats capture failure as a
 * publish-blocking error.
 */
async function captureThumbnails(
  file: File,
  atMs: number,
): Promise<{ full: Blob; small: Blob }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  // Without `crossOrigin` the element treats blob: as same-origin, which
  // is what we want — canvas reads stay non-tainted.
  video.src = url;

  const cleanup = () => {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        video.removeEventListener("loadeddata", onLoaded);
        video.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener("loadeddata", onLoaded);
        video.removeEventListener("error", onError);
        reject(new Error("Could not load video for thumbnail capture"));
      };
      video.addEventListener("loadeddata", onLoaded);
      video.addEventListener("error", onError);
    });

    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
        reject(new Error("Seek failed during thumbnail capture"));
      };
      video.addEventListener("seeked", onSeeked);
      video.addEventListener("error", onError);
      video.currentTime = Math.max(0, atMs / 1000);
    });

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    if (!srcW || !srcH) {
      throw new Error("Video dimensions unavailable for thumbnail");
    }

    const drawToBlob = async (targetWidth: number): Promise<Blob> => {
      const width = Math.min(targetWidth, srcW);
      const height = Math.max(1, Math.round((width * srcH) / srcW));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2D canvas context unavailable");
      ctx.drawImage(video, 0, 0, width, height);
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error("canvas.toBlob returned null"));
          },
          "image/jpeg",
          0.85,
        );
      });
    };

    const full = await drawToBlob(640);
    const small = await drawToBlob(160);
    return { full, small };
  } finally {
    cleanup();
  }
}

/**
 * Probe a file's metadata in the browser by attaching it to a hidden
 * `<video>` and reading the resulting properties. We don't get fps from
 * the HTML media API — display "—FPS" rather than guess.
 */
function probeFile(file: File): Promise<SelectedFile> {
  return new Promise<SelectedFile>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    // Muted + playsInline avoids autoplay quirks on some browsers when
    // metadata loads kick the element into a playing state.
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };

    video.onloadedmetadata = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      const durationMs = Math.round((video.duration || 0) * 1000);
      cleanup();
      if (!width || !height || !durationMs) {
        reject(new Error("Could not read video metadata"));
        return;
      }
      resolve({
        file,
        name: file.name,
        size: formatBytes(file.size),
        resolution: `${width}×${height}`,
        fps: "—FPS",
        duration: formatDuration(durationMs),
        durationMs,
        width,
        height,
        sizeBytes: file.size,
      });
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("Could not read video metadata"));
    };
    video.src = url;
  });
}
