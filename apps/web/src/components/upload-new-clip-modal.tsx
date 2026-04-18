import * as React from "react"
import {
  FolderOpenIcon,
  GlobeIcon,
  Link2Icon,
  LockIcon,
  PlayIcon,
  RotateCcwIcon,
  SkipBackIcon,
  SkipForwardIcon,
  UploadIcon,
  UsersIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { cn } from "@workspace/ui/lib/utils"

export interface SelectedFile {
  name: string
  size: string
  resolution: string
  fps: string
  duration: string
}

interface UploadNewClipModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedFile: SelectedFile | null
  /** Called when the empty-state "Choose file" button is pressed. */
  onSelectFile: () => void
  /** Called when "Replace" is pressed in the loaded state. */
  onClearFile: () => void
}

/**
 * New Clip modal — handles both the empty drop-zone state and the
 * richer editor shown once a file is loaded. The modal grows wider
 * in the loaded state to fit the two-column layout.
 */
export function UploadNewClipModal({
  open,
  onOpenChange,
  selectedFile,
  onSelectFile,
  onClearFile,
}: UploadNewClipModalProps) {
  const hasFile = selectedFile !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          // Custom, larger max-width. Narrow for empty state, wide for
          // editor — the max-width animates so the modal grows into the
          // editor rather than snapping.
          "transition-[max-width] duration-[var(--duration-slow)] ease-[var(--ease-out)]",
          hasFile ? "max-w-[960px]" : "max-w-[640px]"
        )}
        aria-describedby={undefined}
      >
        <NewClipHeader file={selectedFile} onClearFile={onClearFile} />

        {/*
         * Key the inner state on `hasFile` so React tears down the old
         * subtree and mounts the new one — pair that with a fade-in so
         * the editor doesn't pop into place once a file is chosen.
         */}
        <div
          key={hasFile ? "loaded" : "empty"}
          className={cn(
            "animate-in fade-in-0 duration-[var(--duration-slow)] ease-[var(--ease-out)]",
            hasFile && "slide-in-from-bottom-1"
          )}
        >
          {hasFile ? (
            <LoadedState file={selectedFile} />
          ) : (
            <EmptyState onChooseFile={onSelectFile} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ─── Header ────────────────────────────────────────────────────────── */

function NewClipHeader({
  file,
  onClearFile,
}: {
  file: SelectedFile | null
  onClearFile: () => void
}) {
  return (
    <header
      className={cn(
        "relative flex items-start justify-between gap-4",
        "border-b border-border px-6 pt-5 pb-4"
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="eyebrow">Upload</span>
        <h2 className="truncate text-lg font-semibold leading-tight tracking-[-0.02em] text-foreground">
          {file ? `New clip — ${file.name}` : "New clip"}
        </h2>
      </div>

      <div className="flex items-center gap-2">
        {file ? (
          <>
            <MetaBadge>
              {file.resolution} · {file.fps}
            </MetaBadge>
            <MetaBadge>{file.size}</MetaBadge>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearFile}
            >
              <RotateCcwIcon />
              Replace
            </Button>
          </>
        ) : null}
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
            />
          }
        >
          <XIcon />
        </DialogClose>
      </div>
    </header>
  )
}

function MetaBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-[26px] items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2.5",
        "font-mono text-2xs tracking-[0.04em] text-foreground-muted"
      )}
    >
      {children}
    </span>
  )
}

/* ─── Empty state ───────────────────────────────────────────────────── */

function EmptyState({ onChooseFile }: { onChooseFile: () => void }) {
  return (
    <>
      <DialogBody className="px-6 py-5">
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-4 rounded-lg",
            "border border-dashed border-border bg-surface-sunken",
            "px-6 py-12 text-center"
          )}
        >
          <div
            aria-hidden
            className={cn(
              "flex size-14 items-center justify-center rounded-md",
              "border border-border bg-surface-raised text-foreground-muted"
            )}
          >
            <UploadIcon className="size-5" />
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <h3 className="text-lg font-semibold tracking-[-0.015em] text-foreground">
              Drag a video here
            </h3>
            <p className="font-mono text-xs tracking-[0.04em] text-foreground-faint">
              MP4 · MOV · MKV · WEBM — up to 4 GB
            </p>
          </div>

          <div className="mt-1 flex items-center gap-2">
            <Button variant="primary" size="default" onClick={onChooseFile}>
              <FolderOpenIcon />
              Choose file
            </Button>
            <Button variant="secondary" size="default">
              <Link2Icon />
              Paste URL
            </Button>
          </div>
        </div>
      </DialogBody>

      <footer
        className={cn(
          "flex items-center justify-between gap-3",
          "border-t border-border bg-background px-6 py-4"
        )}
      >
        <p className="text-xs text-foreground-faint">
          Alloy reads metadata in the browser — your file only uploads after
          you hit Publish.
        </p>
        <DialogClose render={<Button variant="ghost" size="sm" />}>
          Cancel
        </DialogClose>
      </footer>
    </>
  )
}

/* ─── Loaded (editor) state ─────────────────────────────────────────── */

function LoadedState({ file }: { file: SelectedFile }) {
  const [title, setTitle] = React.useState("Clutch 1v3 on Ascent — retake B")
  const [description, setDescription] = React.useState("")
  const [tags, setTags] = React.useState<Array<string>>([
    "ace",
    "retake",
    "ascent",
  ])
  const [tagDraft, setTagDraft] = React.useState("")
  const [visibility, setVisibility] = React.useState<Visibility>("unlisted")

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/^#/, "").toLowerCase()
    if (!tag) return
    setTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]))
  }

  return (
    <>
      <DialogBody className="grid grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)] gap-6 px-6 py-5">
        {/* Left column — trim / player */}
        <section className="flex flex-col gap-3">
          <Label>Trim</Label>

          <VideoPlayerMock duration={file.duration} />

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon-sm" aria-label="Previous frame">
              <SkipBackIcon />
            </Button>
            <Button variant="primary" size="icon-sm" aria-label="Play">
              <PlayIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next frame">
              <SkipForwardIcon />
            </Button>
            <span className="ml-2 font-mono text-xs tabular-nums text-foreground-dim">
              0:50.00 <span className="text-foreground-faint">/</span>{" "}
              {file.duration}
            </span>

            <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-surface-raised p-0.5">
              <SpeedButton active={false}>½×</SpeedButton>
              <SpeedButton active>1×</SpeedButton>
              <SpeedButton active={false}>2×</SpeedButton>
            </div>
          </div>

          <Timeline />
        </section>

        {/* Right column — metadata form */}
        <section className="flex flex-col gap-4">
          <Field label="Game">
            <SelectMock value="Valorant" />
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
            <div className="mt-1 text-right font-mono text-2xs tabular-nums text-foreground-faint">
              {title.length}/100
            </div>
          </Field>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Add context — optional."
              className={cn(
                "w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground",
                "transition-[border-color,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                "placeholder:text-foreground-faint",
                "hover:border-border-strong",
                "focus-visible:border-accent-border focus-visible:bg-surface-raised focus-visible:outline-none"
              )}
            />
          </Field>

          <Field label="Tags">
            <div
              className={cn(
                "flex min-h-[30px] flex-wrap items-center gap-1.5 rounded-md border border-border bg-input px-2 py-1.5",
                "focus-within:border-accent-border focus-within:bg-surface-raised"
              )}
            >
              {tags.map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    "inline-flex h-5 items-center gap-1 rounded-sm bg-accent-soft px-1.5",
                    "font-mono text-2xs text-accent"
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
                    e.preventDefault()
                    addTag(tagDraft)
                    setTagDraft("")
                  } else if (e.key === "Backspace" && tagDraft === "") {
                    setTags((prev) =>
                      prev.length > 0 ? prev.slice(0, -1) : prev
                    )
                  }
                }}
                placeholder="add tag…"
                className={cn(
                  "min-w-[80px] flex-1 bg-transparent text-xs text-foreground",
                  "placeholder:text-foreground-faint outline-none"
                )}
              />
            </div>
          </Field>

          <Field label="Visibility">
            <VisibilityPicker value={visibility} onChange={setVisibility} />
          </Field>
        </section>
      </DialogBody>

      <footer
        className={cn(
          "flex items-center justify-end gap-2",
          "border-t border-border bg-background px-6 py-4"
        )}
      >
        <Button variant="ghost" size="default">
          Save draft
        </Button>
        <Button variant="primary" size="default">
          <UploadIcon />
          Publish clip
        </Button>
      </footer>
    </>
  )
}

/* ─── Form helpers ──────────────────────────────────────────────────── */

function Field({
  label,
  children,
}: {
  label: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function SelectMock({ value }: { value: string }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-[30px] w-full items-center justify-between gap-2",
        "rounded-md border border-border bg-input px-3 text-sm text-foreground",
        "transition-[border-color,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:border-border-strong",
        "focus-visible:border-accent-border focus-visible:bg-surface-raised focus-visible:outline-none"
      )}
    >
      <span>{value}</span>
      <svg
        aria-hidden
        viewBox="0 0 12 12"
        className="size-3 text-foreground-faint"
      >
        <path
          d="m3 4.5 3 3 3-3"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

type Visibility = "public" | "unlisted" | "friends" | "private"

const VISIBILITY_OPTIONS: Array<{
  value: Visibility
  label: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { value: "public", label: "Public", icon: GlobeIcon },
  { value: "unlisted", label: "Unlisted", icon: Link2Icon },
  { value: "friends", label: "Friends", icon: UsersIcon },
  { value: "private", label: "Private", icon: LockIcon },
]

function VisibilityPicker({
  value,
  onChange,
}: {
  value: Visibility
  onChange: (v: Visibility) => void
}) {
  return (
    <div className="flex items-stretch rounded-md border border-border bg-input p-0.5">
      {VISIBILITY_OPTIONS.map((opt) => {
        const Icon = opt.icon
        const active = opt.value === value
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
                : "text-foreground-dim hover:text-foreground"
            )}
          >
            <Icon className="size-3" />
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function SpeedButton({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-5 items-center justify-center rounded-sm px-1.5",
        "font-mono text-2xs transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-foreground-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

/* ─── Video player + timeline placeholders ──────────────────────────── */

function VideoPlayerMock({ duration }: { duration: string }) {
  return (
    <div
      className={cn(
        "relative aspect-video overflow-hidden rounded-md",
        "bg-[radial-gradient(ellipse_at_center,oklch(0.22_0.04_30)_0%,oklch(0.12_0.02_30)_60%,oklch(0.08_0_0)_100%)]"
      )}
    >
      <button
        type="button"
        aria-label="Play"
        className={cn(
          "absolute left-1/2 top-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center",
          "rounded-full border border-border bg-surface/80 text-foreground",
          "backdrop-blur-sm transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "hover:scale-105 hover:bg-surface"
        )}
      >
        <PlayIcon className="size-5 translate-x-0.5" />
      </button>
      <span
        className={cn(
          "absolute bottom-2 left-2 inline-flex items-center rounded-sm bg-background/80 px-1.5 py-0.5",
          "font-mono text-2xs tabular-nums text-foreground-muted backdrop-blur-sm"
        )}
      >
        0:50 <span className="text-foreground-faint">/</span> {duration}
      </span>
    </div>
  )
}

const TIMELINE_BARS = 80
const TIMELINE_TRIM_START = 14
const TIMELINE_TRIM_END = 26
const TIMELINE_BAR_HEIGHTS: Array<number> = Array.from(
  { length: TIMELINE_BARS },
  (_, i) =>
    Math.min(20 + ((Math.sin(i * 0.45) + 1) * 0.5) * 70 + (i % 7) * 2, 92)
)

/**
 * Fake waveform with a highlighted trim range. Bars use a deterministic
 * pseudo-random pattern so the placeholder looks natural but doesn't
 * flicker between renders.
 */
function Timeline() {
  return (
    <div
      className={cn(
        "relative flex h-14 w-full items-end gap-[2px] overflow-hidden",
        "rounded-md border border-border bg-surface-sunken px-1.5 py-1.5"
      )}
    >
      {TIMELINE_BAR_HEIGHTS.map((h, i) => {
        const inTrim = i >= TIMELINE_TRIM_START && i <= TIMELINE_TRIM_END
        return (
          <span
            key={i}
            aria-hidden
            className={cn(
              "w-full rounded-sm",
              inTrim ? "bg-accent" : "bg-neutral-200"
            )}
            style={{ height: `${h}%` }}
          />
        )
      })}
      {/* Trim range outline */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 rounded-sm ring-2 ring-accent/60"
        style={{
          left: `calc(${(TIMELINE_TRIM_START / TIMELINE_BARS) * 100}% + 4px)`,
          right: `calc(${((TIMELINE_BARS - 1 - TIMELINE_TRIM_END) / TIMELINE_BARS) * 100}% + 4px)`,
        }}
      />
      {/* Time ruler */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-2 bottom-1 flex justify-between font-mono text-2xs text-foreground-faint/70"
      >
        <span>0:00</span>
        <span>1:00</span>
        <span>2:00</span>
        <span>3:00</span>
      </div>
    </div>
  )
}
