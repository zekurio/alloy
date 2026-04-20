import * as React from "react"
import {
  DownloadIcon,
  MaximizeIcon,
  PauseIcon,
  PictureInPicture2Icon,
  PlayIcon,
  SettingsIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

/**
 * VideoPlayer — the single `<video>` surface Alloy renders.
 *
 * Two modes:
 *   - `controls={true}` (default): paints the full Alloy chrome
 *     (centre play button, scrubber with buffered+played fills, mute,
 *     time, settings/PiP/fullscreen) on top of the element. The player
 *     owns playback state in this mode.
 *   - `controls={false}`: bare `<video>` inside the 16:9 wrapper.
 *     The caller drives playback via the `videoRef` — this mode powers
 *     the upload modal's trim preview, where the parent already renders
 *     its own play/rate/volume strip and a trim timeline below.
 *
 * Why one component with a switch instead of two: both modes want the
 * same wrapper (`aspect-video`, `object-contain`, `bg-black`,
 * `rounded-md`, credentials for private streams). Splitting would
 * duplicate that wrapper three ways once fullscreen targeting is added.
 *
 * Private clips work because `crossOrigin="use-credentials"` makes the
 * browser send better-auth's session cookie on the range GET — matches
 * the server's CORS `credentials: true`.
 */

type VideoRef = React.Ref<HTMLVideoElement> | undefined

interface VideoPlayerProps {
  src: string
  poster?: string
  /**
   * Stable identity for the media item. Pass a clip id when `src` can
   * change between qualities for the same clip so resume/view tracking
   * treat that as one playback session instead of a full remount.
   */
  sourceIdentity?: string
  /** Default true — set false to hide the Alloy chrome. */
  controls?: boolean
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  playsInline?: boolean
  preload?: "auto" | "metadata" | "none"
  /** Default `use-credentials` so private streams can carry cookies. */
  crossOrigin?: "anonymous" | "use-credentials"
  className?: string
  /** Forwarded ref onto the underlying `<video>` element. */
  videoRef?: VideoRef
  /**
   * Fired on every `timeupdate`. Only wired in bare mode — the chrome
   * already reads the element directly so redundant parent state
   * would just cause extra renders.
   */
  onTimeUpdate?: (currentTime: number) => void
  /** Play/pause lifecycle — fired from both `play` and `pause` events. */
  onPlayingChange?: (playing: boolean) => void
  /** Proxies to the `<video>` element's click. */
  onVideoClick?: React.MouseEventHandler<HTMLVideoElement>
  /**
   * Fires exactly once per mount when the viewer has accumulated
   * `min(10s, duration * 0.5)` of real playback — "real" meaning
   * cumulative wall-clock time while `playing`, not `currentTime`
   * position. Scrubbing to the end adds zero; background-tab pauses
   * add zero. This is what drives view counting.
   *
   * The threshold is intentionally computed inside the player rather
   * than passed in so the policy is in one place and every surface
   * (dialog, profile page, future embed) gets the same definition of
   * "viewed".
   */
  onPlayThreshold?: () => void
  qualityOptions?: Array<{ id: string; label: string }>
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
  downloadOptions?: Array<{ id: string; label: string; url: string }>
}

// The "viewed" threshold, matching the server's 24h dedup window. Short
// clips get the halfway-point rule so a 3s highlight still counts at
// 1.5s; longer clips cap at 10s so a 20-minute stream doesn't require
// 10 minutes of watch to count. Aligned with what users call "watched".
const PLAY_THRESHOLD_CAP_SEC = 10
const PLAY_THRESHOLD_FRACTION = 0.5

export function VideoPlayer({
  src,
  poster,
  sourceIdentity,
  controls = true,
  autoPlay = false,
  loop = false,
  muted = false,
  playsInline = true,
  preload = "metadata",
  crossOrigin = "use-credentials",
  className,
  videoRef,
  onTimeUpdate,
  onPlayingChange,
  onVideoClick,
  onPlayThreshold,
  qualityOptions,
  selectedQualityId,
  onSelectQuality,
  downloadOptions,
}: VideoPlayerProps) {
  const internalRef = React.useRef<HTMLVideoElement | null>(null)

  // Combined ref — keep our own handle for chrome reads while still
  // forwarding the node to any caller that wants direct access.
  const setVideoNode = React.useCallback(
    (node: HTMLVideoElement | null) => {
      internalRef.current = node
      if (typeof videoRef === "function") {
        videoRef(node)
      } else if (videoRef && "current" in videoRef) {
        ;(videoRef as React.MutableRefObject<HTMLVideoElement | null>).current =
          node
      }
    },
    [videoRef]
  )

  // Threshold tracker — accumulates wall time while `playing` and fires
  // `onPlayThreshold` exactly once when the accumulator crosses the
  // computed threshold. Reset on `src` change so navigating between
  // clips in the same player instance starts a fresh window. Attaches
  // listeners via addEventListener so it composes cleanly with the
  // synthetic handlers the chrome mode already puts on the element.
  usePlayThreshold({
    videoRef: internalRef,
    identity: sourceIdentity ?? src,
    onPlayThreshold,
  })

  const sharedVideoProps = {
    ref: setVideoNode,
    src,
    poster,
    autoPlay,
    loop,
    muted,
    playsInline,
    preload,
    crossOrigin,
    onClick: onVideoClick,
    onTimeUpdate: onTimeUpdate
      ? (e: React.SyntheticEvent<HTMLVideoElement>) =>
          onTimeUpdate(e.currentTarget.currentTime)
      : undefined,
    onPlay: onPlayingChange ? () => onPlayingChange(true) : undefined,
    onPause: onPlayingChange ? () => onPlayingChange(false) : undefined,
    className: "size-full object-contain",
  } as const

  if (!controls) {
    // Bare mode — the parent renders its own chrome and drives playback
    // through `videoRef`. We still clamp to 16:9 so the parent doesn't
    // have to worry about the player's shape.
    return (
      <div
        data-slot="video-player"
        data-mode="bare"
        className={cn(
          "relative aspect-video overflow-hidden rounded-md",
          "border border-border bg-black",
          className
        )}
      >
        <video {...sharedVideoProps} />
      </div>
    )
  }

  return (
    <VideoPlayerWithChrome
      sharedVideoProps={sharedVideoProps}
      videoRefInternal={internalRef}
      sourceIdentity={sourceIdentity ?? src}
      selectedQualityId={selectedQualityId}
      qualityOptions={qualityOptions}
      onSelectQuality={onSelectQuality}
      downloadOptions={downloadOptions}
      className={className}
    />
  )
}

type SharedProps = React.VideoHTMLAttributes<HTMLVideoElement> & {
  ref: (node: HTMLVideoElement | null) => void
}

/**
 * The chrome-mode render. Factored out so the hook machinery (refs,
 * element state mirrors, fullscreen and PiP availability checks) only
 * mounts when we actually need it. Bare mode would waste the effects
 * otherwise.
 */
function VideoPlayerWithChrome({
  sharedVideoProps,
  videoRefInternal,
  sourceIdentity,
  selectedQualityId,
  qualityOptions,
  onSelectQuality,
  downloadOptions,
  className,
}: {
  sharedVideoProps: SharedProps
  videoRefInternal: React.MutableRefObject<HTMLVideoElement | null>
  sourceIdentity: string
  selectedQualityId?: string
  qualityOptions?: Array<{ id: string; label: string }>
  onSelectQuality?: (qualityId: string) => void
  downloadOptions?: Array<{ id: string; label: string; url: string }>
  className?: string
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const resumePlaybackRef = React.useRef<{
    time: number
    shouldPlay: boolean
    sourceIdentity: string
  } | null>(null)
  const prevSourceRef = React.useRef({
    src: String(sharedVideoProps.src ?? ""),
    sourceIdentity,
  })

  // Element-state mirrors. These are driven by the <video>'s own events
  // (never the other way around) so we stay in sync even if someone
  // pokes the element from outside via the forwarded ref.
  const [playing, setPlaying] = React.useState(false)
  const [duration, setDuration] = React.useState(0)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [bufferedEnd, setBufferedEnd] = React.useState(0)
  const [volume, setVolume] = React.useState(1)
  const [muted, setMuted] = React.useState(sharedVideoProps.muted === true)
  // PiP + fullscreen button visibility hinges on browser support.
  // Compute once on mount so SSR never peeks at document.
  const [pipSupported, setPipSupported] = React.useState(false)
  const [fullscreenSupported, setFullscreenSupported] = React.useState(false)
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  React.useEffect(() => {
    if (typeof document === "undefined") return
    setPipSupported(Boolean(document.pictureInPictureEnabled))
    setFullscreenSupported(Boolean(document.fullscreenEnabled))
  }, [])

  // Keep `isFullscreen` in sync with the actual document. Needed so the
  // icon flips when the user exits fullscreen with Esc.
  React.useEffect(() => {
    if (typeof document === "undefined") return
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  React.useEffect(() => {
    const previous = prevSourceRef.current
    const nextSrc = String(sharedVideoProps.src ?? "")
    if (
      previous.src === nextSrc &&
      previous.sourceIdentity === sourceIdentity
    ) {
      return
    }
    const video = videoRefInternal.current
    if (video && previous.sourceIdentity === sourceIdentity) {
      resumePlaybackRef.current = {
        time: video.currentTime,
        shouldPlay: !video.paused && !video.ended,
        sourceIdentity,
      }
    } else {
      resumePlaybackRef.current = null
    }
    prevSourceRef.current = { src: nextSrc, sourceIdentity }
  }, [sharedVideoProps.src, sourceIdentity, videoRefInternal])

  const togglePlay = React.useCallback(() => {
    const v = videoRefInternal.current
    if (!v) return
    if (v.paused) {
      // `play()` can reject in autoplay-blocked or mid-teardown states.
      // Swallow — onPause will land us back in a sane UI state.
      void v.play().catch(() => undefined)
    } else {
      v.pause()
    }
  }, [videoRefInternal])

  const toggleMute = React.useCallback(() => {
    const v = videoRefInternal.current
    if (!v) return
    v.muted = !v.muted
  }, [videoRefInternal])

  const onVolumeSliderChange = React.useCallback(
    (next: number) => {
      const v = videoRefInternal.current
      if (!v) return
      const clamped = Math.max(0, Math.min(1, next))
      v.volume = clamped
      // Lifting the slider off zero implicitly unmutes — matches native
      // browser players and avoids the "slider moved but no sound" bug.
      if (clamped > 0 && v.muted) v.muted = false
    },
    [videoRefInternal]
  )

  const togglePictureInPicture = React.useCallback(async () => {
    const v = videoRefInternal.current
    if (!v || !document.pictureInPictureEnabled) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else {
        await v.requestPictureInPicture()
      }
    } catch {
      // Most PiP failures are "gesture not direct" or "disabled by
      // policy" — nothing the UI can do. Swallow.
    }
  }, [videoRefInternal])

  const toggleFullscreen = React.useCallback(async () => {
    const el = containerRef.current
    if (!el) return
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen()
      } else {
        await el.requestFullscreen()
      }
    } catch {
      // Browser refused — e.g. iOS doesn't allow container fullscreen
      // on non-<video> elements. Nothing we can surface without noise.
    }
  }, [])

  const seekTo = React.useCallback(
    (targetSec: number) => {
      const v = videoRefInternal.current
      if (!v || !Number.isFinite(targetSec)) return
      const clamped = Math.max(0, Math.min(targetSec, v.duration || 0))
      // `fastSeek` is cheaper on long files but not universal; fall
      // back to direct assignment.
      if (typeof v.fastSeek === "function") {
        v.fastSeek(clamped)
      } else {
        v.currentTime = clamped
      }
      setCurrentTime(clamped)
    },
    [videoRefInternal]
  )

  // Keyboard shortcut: space toggles play when the player is focused.
  // Arrow keys seek ±5s, M mutes, F fullscreens. Matches YouTube.
  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Don't hijack keys while the user is interacting with the
      // scrubber — its own ArrowLeft/ArrowRight handlers take over.
      if (e.target !== e.currentTarget) return
      if (e.key === " " || e.code === "Space") {
        e.preventDefault()
        togglePlay()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        seekTo((videoRefInternal.current?.currentTime ?? 0) - 5)
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        seekTo((videoRefInternal.current?.currentTime ?? 0) + 5)
      } else if (e.key.toLowerCase() === "m") {
        e.preventDefault()
        toggleMute()
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault()
        void toggleFullscreen()
      }
    },
    [togglePlay, toggleMute, toggleFullscreen, seekTo, videoRefInternal]
  )

  // Wire element events onto our state mirrors. React's synthetic
  // events work fine here but `progress` is famously flaky in the
  // synthetic layer, so we read `buffered` on timeupdate too.
  const onPlayEvent = React.useCallback(() => setPlaying(true), [])
  const onPauseEvent = React.useCallback(() => setPlaying(false), [])
  const onLoaded = React.useCallback(() => {
    const v = videoRefInternal.current
    if (!v) return
    setDuration(v.duration || 0)
    setVolume(v.volume)
    setMuted(v.muted)
    const resume = resumePlaybackRef.current
    if (!resume || resume.sourceIdentity !== sourceIdentity) return
    const maxSeek = Math.max(0, (v.duration || 0) - 0.1)
    const target = Math.min(resume.time, maxSeek)
    if (target > 0) {
      if (typeof v.fastSeek === "function") {
        v.fastSeek(target)
      } else {
        v.currentTime = target
      }
      setCurrentTime(target)
    }
    if (resume.shouldPlay) {
      void v.play().catch(() => undefined)
    }
    resumePlaybackRef.current = null
  }, [sourceIdentity, videoRefInternal])
  const onTimeEvent = React.useCallback(() => {
    const v = videoRefInternal.current
    if (!v) return
    setCurrentTime(v.currentTime)
    const buffered = v.buffered
    if (buffered.length > 0) {
      // Last buffered range past currentTime is what we paint — a
      // seek earlier doesn't wipe older buffered ranges, so grab the
      // farthest end point.
      let end = 0
      for (let i = 0; i < buffered.length; i++) {
        end = Math.max(end, buffered.end(i))
      }
      setBufferedEnd(end)
    }
  }, [videoRefInternal])
  const onVolumeEvent = React.useCallback(() => {
    const v = videoRefInternal.current
    if (!v) return
    setVolume(v.volume)
    setMuted(v.muted)
  }, [videoRefInternal])

  return (
    <div
      ref={containerRef}
      data-slot="video-player"
      data-mode="chrome"
      data-playing={playing ? "true" : "false"}
      // `tabIndex=-1` so the container isn't a tab stop, but keyboard
      // shortcuts still route to it when it has programmatic focus.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        "group/video relative aspect-video w-full overflow-hidden rounded-md select-none",
        "bg-black shadow-[0_0_0_1px_var(--border)]",
        "focus:outline-none",
        className
      )}
    >
      <video
        {...sharedVideoProps}
        onClick={(e) => {
          sharedVideoProps.onClick?.(e)
          togglePlay()
        }}
        onPlay={onPlayEvent}
        onPause={onPauseEvent}
        onLoadedMetadata={onLoaded}
        onDurationChange={onLoaded}
        onTimeUpdate={onTimeEvent}
        onProgress={onTimeEvent}
        onVolumeChange={onVolumeEvent}
      />

      {/* Centre play button when paused */}
      {!playing ? (
        <button
          type="button"
          aria-label="Play"
          onClick={togglePlay}
          className={cn(
            "absolute inset-0 grid place-items-center",
            "bg-[color-mix(in_oklab,var(--neutral-0)_40%,transparent)]",
            "transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]"
          )}
        >
          <span
            className={cn(
              "grid size-14 place-items-center rounded-full",
              "bg-accent text-accent-foreground",
              "shadow-[0_0_0_6px_var(--accent-soft),0_12px_32px_-8px_var(--accent-glow)]",
              "transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out)]",
              "group-hover/video:scale-105"
            )}
          >
            <PlayIcon className="size-5 translate-x-[1px]" />
          </span>
        </button>
      ) : null}

      {/* Bottom gradient + chrome */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex flex-col gap-2 px-4 pt-10 pb-3",
          "bg-[linear-gradient(to_top,oklch(0.08_0_0/0.85)_0%,oklch(0.08_0_0/0.4)_60%,transparent_100%)]"
        )}
      >
        <Scrubber
          currentTime={currentTime}
          duration={duration}
          bufferedEnd={bufferedEnd}
          onSeek={seekTo}
        />

        <div className="flex items-center gap-2 text-foreground">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={playing ? "Pause" : "Play"}
            onClick={togglePlay}
            className="text-foreground hover:bg-[color-mix(in_oklab,var(--neutral-900)_10%,transparent)]"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </Button>

          <VolumeControl
            muted={muted}
            volume={volume}
            onToggleMute={toggleMute}
            onVolumeChange={onVolumeSliderChange}
          />

          <span className="ml-1 font-mono text-2xs tracking-[0.06em] text-foreground">
            <span className="text-accent">{formatTime(currentTime)}</span>
            <span className="mx-1 text-foreground-faint">/</span>
            <span className="text-foreground-muted">
              {formatTime(duration)}
            </span>
          </span>

          <div className="ml-auto flex items-center gap-0.5">
            <SettingsMenu
              qualityOptions={qualityOptions}
              selectedQualityId={selectedQualityId}
              onSelectQuality={onSelectQuality}
              downloadOptions={downloadOptions}
            />
            {pipSupported ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Picture-in-picture"
                onClick={() => void togglePictureInPicture()}
                className="text-foreground hover:bg-[color-mix(in_oklab,var(--neutral-900)_10%,transparent)]"
              >
                <PictureInPicture2Icon />
              </Button>
            ) : null}
            {fullscreenSupported ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                onClick={() => void toggleFullscreen()}
                className="text-foreground hover:bg-[color-mix(in_oklab,var(--neutral-900)_10%,transparent)]"
              >
                <MaximizeIcon />
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsMenu({
  qualityOptions = [],
  selectedQualityId,
  onSelectQuality,
  downloadOptions = [],
}: {
  qualityOptions?: Array<{ id: string; label: string }>
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
  downloadOptions?: Array<{ id: string; label: string; url: string }>
}) {
  const hasQualityChoices =
    qualityOptions.length > 1 && Boolean(onSelectQuality)
  const hasDownloads = downloadOptions.length > 0
  if (!hasQualityChoices && !hasDownloads) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Settings"
            className="text-foreground hover:bg-[color-mix(in_oklab,var(--neutral-900)_10%,transparent)]"
          >
            <SettingsIcon />
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={8}>
        {hasQualityChoices ? (
          <>
            <DropdownMenuLabel>Quality</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={selectedQualityId}
              onValueChange={onSelectQuality}
            >
              {qualityOptions.map((quality) => (
                <DropdownMenuRadioItem key={quality.id} value={quality.id}>
                  {quality.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}

        {hasQualityChoices && hasDownloads ? <DropdownMenuSeparator /> : null}

        {hasDownloads ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <DownloadIcon />
              Download
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {downloadOptions.map((download) => (
                <DropdownMenuItem
                  key={download.id}
                  onClick={() => startDownload(download.url)}
                >
                  {download.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Scrubber with buffered + played fills, a hover-only thumb, and
 * pointer-capture drag. Click-to-seek + drag both land in the same
 * `onSeek` callback so the parent doesn't see two different code paths.
 *
 * Why pointer events: a drag that starts on the rail and ends halfway
 * across the page should still scrub. Mouse events drop the moment the
 * cursor leaves, so the scrubber feels "sticky" unless we upgrade to
 * pointer with `setPointerCapture`.
 */
function Scrubber({
  currentTime,
  duration,
  bufferedEnd,
  onSeek,
}: {
  currentTime: number
  duration: number
  bufferedEnd: number
  onSeek: (sec: number) => void
}) {
  const railRef = React.useRef<HTMLDivElement>(null)
  const draggingIdRef = React.useRef<number | null>(null)

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const buffered = duration > 0 ? (bufferedEnd / duration) * 100 : 0

  const secFromClientX = React.useCallback(
    (clientX: number): number => {
      const rail = railRef.current
      if (!rail || duration <= 0) return 0
      const rect = rail.getBoundingClientRect()
      const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return pct * duration
    },
    [duration]
  )

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingIdRef.current = e.pointerId
    onSeek(secFromClientX(e.clientX))
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingIdRef.current !== e.pointerId) return
    onSeek(secFromClientX(e.clientX))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingIdRef.current !== e.pointerId) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    draggingIdRef.current = null
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault()
      onSeek(Math.max(0, currentTime - 5))
    } else if (e.key === "ArrowRight") {
      e.preventDefault()
      onSeek(Math.min(duration, currentTime + 5))
    } else if (e.key === "Home") {
      e.preventDefault()
      onSeek(0)
    } else if (e.key === "End") {
      e.preventDefault()
      onSeek(duration)
    }
  }

  return (
    <div
      ref={railRef}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, Math.round(duration))}
      aria-valuenow={Math.round(currentTime)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        "group/scrub relative h-1 w-full cursor-pointer touch-none rounded-full",
        "bg-[color-mix(in_oklab,var(--neutral-900)_18%,transparent)]",
        "transition-[height] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
        "hover:h-[5px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      )}
    >
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_oklab,var(--neutral-900)_32%,transparent)]"
        style={{ width: `${buffered}%` }}
      />
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 rounded-full bg-accent shadow-[0_0_6px_var(--accent-glow)]"
        style={{ width: `${progress}%` }}
      />
      <div
        aria-hidden
        className={cn(
          "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full",
          "bg-accent shadow-[0_0_0_3px_var(--accent-soft)]",
          "opacity-0 transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "group-hover/scrub:opacity-100"
        )}
        style={{ left: `${progress}%` }}
      />
    </div>
  )
}

/**
 * Mute toggle + hover-expanding volume slider. The slider lives inside
 * the same hover-group as the speaker button so grazing the speaker
 * reveals the rail without a click. Pointer-capture on the rail gives a
 * sticky drag even when the cursor leaves.
 */
export function VolumeControl({
  muted,
  volume,
  onToggleMute,
  onVolumeChange,
  className,
}: {
  muted: boolean
  volume: number
  onToggleMute: () => void
  onVolumeChange: (next: number) => void
  /** Extra classes on the outer wrapper — useful when the control is placed in an external toolbar row (e.g. the upload trim controls). */
  className?: string
}) {
  const railRef = React.useRef<HTMLDivElement>(null)
  const draggingIdRef = React.useRef<number | null>(null)

  const effective = muted ? 0 : volume
  const Icon =
    muted || volume === 0
      ? VolumeXIcon
      : volume < 0.5
        ? Volume1Icon
        : Volume2Icon

  const computeVolume = React.useCallback((clientX: number): number => {
    const rail = railRef.current
    if (!rail) return 0
    const rect = rail.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingIdRef.current = e.pointerId
    onVolumeChange(computeVolume(e.clientX))
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingIdRef.current !== e.pointerId) return
    onVolumeChange(computeVolume(e.clientX))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingIdRef.current !== e.pointerId) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    draggingIdRef.current = null
  }

  return (
    <div className={cn("group/vol flex items-center", className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={muted ? "Unmute" : "Mute"}
        onClick={onToggleMute}
        className="text-foreground hover:bg-[color-mix(in_oklab,var(--neutral-900)_10%,transparent)]"
      >
        <Icon />
      </Button>

      <div
        ref={railRef}
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(effective * 100)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault()
            onVolumeChange(Math.max(0, effective - 0.1))
          } else if (e.key === "ArrowRight") {
            e.preventDefault()
            onVolumeChange(Math.min(1, effective + 0.1))
          }
        }}
        className={cn(
          "relative h-1 cursor-pointer touch-none overflow-hidden rounded-full",
          "bg-[color-mix(in_oklab,var(--neutral-900)_18%,transparent)]",
          "w-0 opacity-0 transition-[width,opacity] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          // Reveal the rail when the mute button or the rail itself is
          // hovered/focused. The extra `focus-within` covers keyboard
          // users landing on the rail via Tab.
          "group-hover/vol:ml-1 group-hover/vol:w-16 group-hover/vol:opacity-100",
          "focus-within:ml-1 focus-within:w-16 focus-within:opacity-100",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      >
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: `${effective * 100}%` }}
        />
      </div>
    </div>
  )
}

/**
 * Subscribe to a `<video>` element and fire `onPlayThreshold` exactly
 * once when cumulative-while-playing wall time crosses the viewed
 * threshold. "Wall time" — not `currentTime` — so scrubbing to the end
 * counts for zero and a pause in the middle of the clip doesn't pad
 * the accumulator while no frames are playing.
 *
 * The implementation is deliberately DOM-level (addEventListener on
 * the ref'd node) so it composes cleanly with the synthetic handlers
 * both bare and chrome modes have already wired onto the element.
 *
 * `src` is a dep so navigating between clips in the same player
 * instance resets the accumulator and re-arms the one-shot callback.
 */
function usePlayThreshold({
  videoRef,
  identity,
  onPlayThreshold,
}: {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  identity: string
  onPlayThreshold: (() => void) | undefined
}): void {
  // Latest callback in a ref so resubscribing on every render-prop-
  // identity change isn't needed. Callers passing an inline arrow still
  // see the newest closure fire on the threshold crossing.
  const callbackRef = React.useRef(onPlayThreshold)
  React.useEffect(() => {
    callbackRef.current = onPlayThreshold
  }, [onPlayThreshold])

  React.useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (!callbackRef.current) return

    // Per-mount accumulator. Reset on every `src` change (dep) so a
    // single player instance navigating through multiple clips re-arms
    // correctly.
    let accumulatedMs = 0
    let lastTickAt: number | null = null
    let fired = false

    const threshold = () => {
      const durSec = el.duration
      // When duration is unknown (metadata not loaded yet) assume a
      // long clip — caps at 10s. Once metadata arrives the next tick
      // recomputes with the real value. Clamping at duration keeps the
      // math sensible for sub-second clips.
      const base = Number.isFinite(durSec) && durSec > 0 ? durSec : 60
      return Math.min(PLAY_THRESHOLD_CAP_SEC, base * PLAY_THRESHOLD_FRACTION)
    }

    const tick = () => {
      if (fired || lastTickAt === null) return
      const now = performance.now()
      accumulatedMs += now - lastTickAt
      lastTickAt = now
      if (accumulatedMs / 1000 >= threshold()) {
        fired = true
        callbackRef.current?.()
      }
    }

    const onPlay = () => {
      if (fired) return
      lastTickAt = performance.now()
    }
    const onPause = () => {
      tick()
      lastTickAt = null
    }
    const onTime = () => {
      if (lastTickAt === null) return
      tick()
    }

    el.addEventListener("play", onPlay)
    el.addEventListener("playing", onPlay)
    el.addEventListener("pause", onPause)
    el.addEventListener("ended", onPause)
    el.addEventListener("timeupdate", onTime)

    // If the element is already playing when we attach (e.g. autoPlay
    // kicked off before this effect ran), seed lastTickAt immediately
    // so we start accumulating from now.
    if (!el.paused && !el.ended) {
      lastTickAt = performance.now()
    }

    return () => {
      el.removeEventListener("play", onPlay)
      el.removeEventListener("playing", onPlay)
      el.removeEventListener("pause", onPause)
      el.removeEventListener("ended", onPause)
      el.removeEventListener("timeupdate", onTime)
    }
    // videoRef is a stable ref object; src reset is the semantic trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity])
}

function startDownload(url: string): void {
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.rel = "noopener"
  anchor.style.display = "none"
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

function formatTime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "0:00"
  const total = Math.floor(totalSec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = s.toString().padStart(2, "0")
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${ss}`
  return `${m}:${ss}`
}
