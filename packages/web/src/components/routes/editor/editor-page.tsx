import { useNavigate } from "@tanstack/react-router"
import { type ClipRow, clipStreamUrl, clipThumbnailUrl } from "alloy-api"
import { AppMain } from "alloy-ui/components/app-shell"
import { Button } from "alloy-ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "alloy-ui/components/dialog"
import { Field, FieldLabel } from "alloy-ui/components/field"
import { Progress } from "alloy-ui/components/progress"
import { SectionTitle } from "alloy-ui/components/section-head"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "alloy-ui/components/select"
import { Spinner } from "alloy-ui/components/spinner"
import { toast } from "alloy-ui/lib/toast"
import {
  ClapperboardIcon,
  HardDriveIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Redo2Icon,
  SaveIcon,
  ScissorsIcon,
  Trash2Icon,
  Undo2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"
import * as React from "react"

import { LibraryEmpty } from "@/components/routes/library/library-page"
import { useSession } from "@/lib/auth-client"
import { useUserClipsQuery } from "@/lib/clip-queries"
import {
  alloyDesktop,
  type AlloyDesktop,
  type RecordingLibraryItem,
  type RecordingLibraryProject,
} from "@/lib/desktop"
import { apiOrigin } from "@/lib/env"
import { errorMessage } from "@/lib/error-message"
import { formatTrimMs } from "@/lib/media-time"

import { useLibrarySnapshot } from "../library/library-data"
import { type EditorMediaItem, EditorMediaPanel } from "./editor-media-panel"
import { EditorPreview } from "./editor-preview"
import {
  addClip,
  addTrack,
  clipAtTimelineMs,
  clipEndMs,
  type EditorMediaSource,
  type EditorProject,
  findClip,
  moveClip,
  newProject,
  projectDurationMs,
  projectsEqual,
  removeClip,
  removeTrack,
  splitClipAt,
  toggleTransition,
  trimClipEnd,
  trimClipStart,
} from "./editor-project"
import {
  DEFAULT_RENDER_SETTINGS,
  encodableRenderCodecs,
  RENDER_ACCELERATIONS,
  RENDER_FPS_OPTIONS,
  RENDER_QUALITIES,
  RENDER_RESOLUTIONS,
  type RenderAcceleration,
  type RenderCodec,
  type RenderQuality,
  type RenderResolution,
  renderProject,
  type RenderSettings,
} from "./editor-render"
import {
  clampTimelineZoom,
  MAX_TIMELINE_ZOOM,
  MultitrackTimeline,
} from "./editor-timeline"
import { useEditorHistory } from "./use-editor-history"

const ZOOM_STEP = 1.5
const KEYBOARD_SEEK_MS = 100
const KEYBOARD_LONG_SEEK_MS = 1000
/** Span padding so there's always room to drag clips toward the right. */
const SPAN_QUANTUM_MS = 30_000
const DEFAULT_PROJECT_NAME = "Untitled project"

const CODEC_LABELS: Record<RenderCodec, string> = {
  avc: "H.264 (AVC)",
  hevc: "H.265 (HEVC)",
  vp9: "VP9",
  av1: "AV1",
}
const RESOLUTION_LABELS: Record<RenderResolution, string> = {
  source: "Source resolution",
  "1440": "1440p",
  "1080": "1080p",
  "720": "720p",
}
const QUALITY_LABELS: Record<RenderQuality, string> = {
  medium: "Medium",
  high: "High",
  "very-high": "Very high",
}
const ACCELERATION_LABELS: Record<RenderAcceleration, string> = {
  auto: "Auto",
  gpu: "GPU (hardware)",
  cpu: "CPU (software)",
}

export function EditorPage({
  draftId,
  seedCaptureId,
}: {
  draftId?: string
  seedCaptureId?: string
}) {
  const desktop = alloyDesktop()

  if (!desktop) {
    return (
      <AppMain>
        <LibraryEmpty
          icon={<HardDriveIcon />}
          title="The editor is only available in Alloy Desktop"
          description="Open Alloy in the desktop app to edit captures stored on this device."
        />
      </AppMain>
    )
  }

  return (
    <EditorContent
      desktop={desktop}
      draftId={draftId}
      seedCaptureId={seedCaptureId}
    />
  )
}

/**
 * Project editor: a multitrack timeline over media sources from the local
 * library. The project is decoupled from the captures — clips reference
 * sources, any capture can be added (multiple times), and the editor can
 * start from an empty project.
 */
function EditorContent({
  desktop,
  draftId,
  seedCaptureId,
}: {
  desktop: AlloyDesktop
  draftId?: string
  seedCaptureId?: string
}) {
  const navigate = useNavigate()
  const { snapshot, refresh } = useLibrarySnapshot(desktop)
  const [initialProject] = React.useState(newProject)
  const history = useEditorHistory<EditorProject>(initialProject, projectsEqual)
  const project = history.present
  const projectRef = React.useRef(project)
  projectRef.current = project

  const [selectedClipId, setSelectedClipId] = React.useState<string | null>(
    null,
  )
  const [currentMs, setCurrentMs] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [zoom, setZoom] = React.useState(1)
  const [projectName, setProjectName] = React.useState(DEFAULT_PROJECT_NAME)
  const [savedDraftId, setSavedDraftId] = React.useState<string | null>(
    draftId ?? null,
  )
  const [draftSaveStatus, setDraftSaveStatus] = React.useState<
    "idle" | "saving" | "saved"
  >("idle")
  const currentMsRef = React.useRef(0)
  const loadedDraftIdRef = React.useRef<string | null>(null)
  const lastSavedSignatureRef = React.useRef<string | null>(null)

  const localItems = React.useMemo(
    () =>
      (snapshot?.items ?? []).filter(
        (item) => item.kind !== "screenshot" && (item.durationMs ?? 0) > 0,
      ),
    [snapshot],
  )
  // Uploaded clips stream from the server as additional sources; only
  // fully processed ones have a stable source to cut from.
  const { data: session } = useSession()
  const uploadedQuery = useUserClipsQuery(session?.user?.username ?? "")
  const cloudClips = React.useMemo(
    () =>
      (uploadedQuery.data ?? []).filter(
        (row) =>
          row.status === "ready" &&
          (row.durationMs ?? 0) > 0 &&
          row.sourceContentType,
      ),
    [uploadedQuery.data],
  )

  const mediaItems = React.useMemo<EditorMediaItem[]>(
    () => [
      ...localItems.map(localMediaItem),
      ...cloudClips.map(cloudMediaItem),
    ],
    [localItems, cloudClips],
  )
  const sources = React.useMemo(() => {
    const map = new Map<string, EditorMediaSource>()
    for (const item of localItems) map.set(item.id, mediaSourceFor(item))
    for (const row of cloudClips) map.set(row.id, cloudSourceFor(row))
    return map
  }, [localItems, cloudClips])

  React.useEffect(() => {
    const signature = projectDraftSignature(projectName, project)
    if (
      draftSaveStatus === "saved" &&
      lastSavedSignatureRef.current !== signature
    ) {
      setDraftSaveStatus("idle")
    }
  }, [draftSaveStatus, projectName, project])

  const totalMs = projectDurationMs(project)
  // The span (the timeline's time-per-pixel frame) freezes while a drag is
  // in flight: live move/trim edits change the project duration, and a span
  // that grew mid-drag would remap the pointer to ever-later times — a
  // runaway feedback loop that flings the clip to the right.
  const computedSpanMs = Math.max(
    2 * SPAN_QUANTUM_MS,
    Math.ceil((totalMs * 1.25) / SPAN_QUANTUM_MS) * SPAN_QUANTUM_MS,
  )
  const [frozenSpanMs, setFrozenSpanMs] = React.useState<number | null>(null)
  const spanMs = frozenSpanMs ?? computedSpanMs

  const seek = React.useCallback(
    (timelineMs: number) => {
      const clamped = Math.min(Math.max(0, timelineMs), spanMs)
      currentMsRef.current = clamped
      setCurrentMs(clamped)
    },
    [spanMs],
  )

  /* ── Master clock: timeline time advances on wall clock while playing. ── */
  React.useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const deltaMs = now - last
      last = now
      const total = projectDurationMs(projectRef.current)
      let next = currentMsRef.current + deltaMs
      if (total > 0 && next >= total) {
        next = total
        setPlaying(false)
      }
      currentMsRef.current = next
      setCurrentMs(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  /* ── Seed: "Open in Editor" starts the project with that capture. ── */
  // Waits until the seed id resolves to a source — local captures land with
  // the snapshot, uploaded clips with the clips query — then seeds once.
  const seededRef = React.useRef(false)
  React.useEffect(() => {
    if (seededRef.current || !seedCaptureId || draftId) return
    const source = sources.get(seedCaptureId)
    if (!source) return
    seededRef.current = true
    const current = projectRef.current
    if (current.clips.length > 0) return
    const topTrack = current.tracks[0]
    if (!topTrack) return
    const added = addClip(current, source, topTrack.id, 0)
    history.apply(added.project)
    setSelectedClipId(added.clipId)
  }, [draftId, seedCaptureId, sources, history])

  /* ── Draft loading: library cards reopen their saved project state. ── */
  React.useEffect(() => {
    if (!draftId || loadedDraftIdRef.current === draftId || !snapshot) return
    const draft =
      snapshot.projectDrafts.find((entry) => entry.id === draftId) ?? null
    if (!draft) return

    loadedDraftIdRef.current = draft.id
    seededRef.current = true
    setSavedDraftId(draft.id)
    setProjectName(draft.title)
    setSelectedClipId(null)
    setPlaying(false)
    currentMsRef.current = 0
    setCurrentMs(0)
    history.reset(draft.project as EditorProject)
    lastSavedSignatureRef.current = projectDraftSignature(
      draft.title,
      draft.project as RecordingLibraryProject,
    )
    setDraftSaveStatus("saved")
  }, [draftId, snapshot, history])

  /* ── Edit operations ── */

  const addFromLibrary = (item: EditorMediaItem) => {
    const source = sources.get(item.id)
    if (!source) return
    // New material lands on the topmost track, overlaying what's below.
    const topTrack = project.tracks[0]
    if (!topTrack) return
    const added = addClip(project, source, topTrack.id, currentMs)
    history.apply(added.project)
    setSelectedClipId(added.clipId)
  }

  const splitAtPlayhead = () => {
    const target = splitTarget(project, selectedClipId, currentMs)
    if (!target) return
    const result = splitClipAt(project, target.id, currentMs)
    if (!result) return
    history.apply(result.project)
    setSelectedClipId(result.rightClipId)
  }

  const deleteSelected = () => {
    if (!selectedClipId) return
    history.apply(removeClip(project, selectedClipId))
    setSelectedClipId(null)
  }

  const togglePlayback = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (project.clips.length === 0) return
    // Restart from the top once the arrangement has fully played.
    if (totalMs > 0 && currentMsRef.current >= totalMs - 10) seek(0)
    setPlaying(true)
  }

  const seekByKeyboard = (deltaMs: number) => {
    seek(currentMsRef.current + deltaMs)
  }

  const seekToTimelineEnd = () => {
    seek(totalMs > 0 ? totalMs : spanMs)
  }

  const saveDraft = React.useCallback(async () => {
    if (project.clips.length === 0 || draftSaveStatus === "saving") return
    setDraftSaveStatus("saving")
    try {
      const saved = await desktop.recording.saveLibraryProjectDraft({
        id: savedDraftId,
        title: projectName,
        project,
      })
      setSavedDraftId(saved.id)
      loadedDraftIdRef.current = saved.id
      lastSavedSignatureRef.current = projectDraftSignature(
        projectName,
        project,
      )
      setDraftSaveStatus("saved")
      toast.success("Draft saved")
      void refresh()
      if (!savedDraftId) {
        void navigate({
          to: "/editor",
          search: { draft: saved.id },
          replace: true,
        })
      }
    } catch (cause) {
      setDraftSaveStatus("idle")
      toast.error(errorMessage(cause, "Couldn't save the draft"))
    }
  }, [
    desktop,
    draftSaveStatus,
    navigate,
    project,
    projectName,
    refresh,
    savedDraftId,
  ])

  /* ── Keyboard shortcuts ── */

  const keyActionsRef = React.useRef({
    togglePlayback,
    splitAtPlayhead,
    deleteSelected,
    saveDraft,
    seekByKeyboard,
    seekToStart: () => seek(0),
    seekToTimelineEnd,
    zoomIn: () => setZoom((current) => clampTimelineZoom(current * ZOOM_STEP)),
    zoomOut: () => setZoom((current) => clampTimelineZoom(current / ZOOM_STEP)),
    undo: history.undo,
    redo: history.redo,
  })
  keyActionsRef.current = {
    togglePlayback,
    splitAtPlayhead,
    deleteSelected,
    saveDraft,
    seekByKeyboard,
    seekToStart: () => seek(0),
    seekToTimelineEnd,
    zoomIn: () => setZoom((current) => clampTimelineZoom(current * ZOOM_STEP)),
    zoomOut: () => setZoom((current) => clampTimelineZoom(current / ZOOM_STEP)),
    undo: history.undo,
    redo: history.redo,
  }
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.closest('[role="dialog"]'))
      ) {
        return
      }
      const actions = keyActionsRef.current
      const key = event.key.toLowerCase()
      if (event.key === " ") {
        event.preventDefault()
        actions.togglePlayback()
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault()
        actions.deleteSelected()
      } else if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault()
        if (event.shiftKey) actions.redo()
        else actions.undo()
      } else if ((event.ctrlKey || event.metaKey) && key === "y") {
        event.preventDefault()
        actions.redo()
      } else if ((event.ctrlKey || event.metaKey) && key === "s") {
        event.preventDefault()
        void actions.saveDraft()
      } else if (
        (event.ctrlKey || event.metaKey) &&
        (key === "=" || key === "+")
      ) {
        event.preventDefault()
        actions.zoomIn()
      } else if ((event.ctrlKey || event.metaKey) && key === "-") {
        event.preventDefault()
        actions.zoomOut()
      } else if (
        event.key === "ArrowLeft" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault()
        actions.seekByKeyboard(
          event.shiftKey ? -KEYBOARD_LONG_SEEK_MS : -KEYBOARD_SEEK_MS,
        )
      } else if (
        event.key === "ArrowRight" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault()
        actions.seekByKeyboard(
          event.shiftKey ? KEYBOARD_LONG_SEEK_MS : KEYBOARD_SEEK_MS,
        )
      } else if (
        event.key === "Home" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault()
        actions.seekToStart()
      } else if (
        event.key === "End" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault()
        actions.seekToTimelineEnd()
      } else if (
        key === "s" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault()
        actions.splitAtPlayhead()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  /* ── Render & save to the library ── */

  const [renderDialogOpen, setRenderDialogOpen] = React.useState(false)
  const [renderSettings, setRenderSettings] = React.useState<RenderSettings>(
    DEFAULT_RENDER_SETTINGS,
  )
  // Null until probed; the codec select shows what this machine encodes.
  const [renderCodecs, setRenderCodecs] = React.useState<RenderCodec[] | null>(
    null,
  )
  const [renderFraction, setRenderFraction] = React.useState<number | null>(
    null,
  )
  const renderAbortRef = React.useRef<AbortController | null>(null)

  const openRenderDialog = () => {
    if (project.clips.length === 0) return
    setPlaying(false)
    setRenderDialogOpen(true)
    if (renderCodecs === null) {
      void encodableRenderCodecs().then((codecs) => {
        setRenderCodecs(codecs)
        // Drop an unencodable default (e.g. no AV1 encoder).
        setRenderSettings((current) =>
          codecs.length > 0 && !codecs.includes(current.codec)
            ? { ...current, codec: codecs[0] }
            : current,
        )
      })
    }
  }

  const startRender = async () => {
    if (renderFraction !== null || project.clips.length === 0) return
    const abort = new AbortController()
    renderAbortRef.current = abort
    setRenderFraction(0)
    try {
      const rendered = await renderProject(
        project,
        sources,
        renderSettings,
        (fraction) => setRenderFraction(fraction),
        abort.signal,
      )
      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[T:]/g, "-")
      const saved = await desktop.recording.importLibraryCapture({
        fileName: renderFileName(projectName, timestamp),
        data: rendered.data,
        durationMs: rendered.durationMs,
        width: rendered.width,
        height: rendered.height,
      })
      toast.success("Render saved to your library")
      setRenderDialogOpen(false)
      void navigate({
        to: "/library/$captureId",
        params: { captureId: saved.id },
      })
    } catch (cause) {
      if (!abort.signal.aborted) {
        toast.error(errorMessage(cause, "Couldn't render the project"))
      }
    } finally {
      renderAbortRef.current = null
      setRenderFraction(null)
    }
  }

  const cancelRender = () => {
    renderAbortRef.current?.abort()
  }

  const selectedClip = selectedClipId ? findClip(project, selectedClipId) : null
  const canSplit = splitTarget(project, selectedClipId, currentMs) !== null

  return (
    <AppMain>
      <section className="flex h-[calc(100dvh-var(--header-h)-2rem)] min-h-0 w-full flex-col gap-3 md:h-[calc(100dvh-var(--header-h)-3rem)]">
        {/* ── Top bar ── */}
        <div className="flex items-center gap-3">
          <EditableProjectName value={projectName} onChange={setProjectName} />
          <div className="flex-1" />
          {draftSaveStatus === "saved" ? (
            <span className="text-foreground-faint text-sm">Saved</span>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={
              project.clips.length === 0 || draftSaveStatus === "saving"
            }
            onClick={() => {
              void saveDraft()
            }}
          >
            <SaveIcon />
            {draftSaveStatus === "saving" ? "Saving..." : "Save draft"}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={project.clips.length === 0 || renderDialogOpen}
            onClick={openRenderDialog}
          >
            Render video
          </Button>
        </div>

        {/* ── Render: settings first, then modal progress. ── */}
        <Dialog
          open={renderDialogOpen}
          onOpenChange={(open) => {
            // No dismissing mid-render; Cancel aborts instead.
            if (!open && renderFraction === null) setRenderDialogOpen(false)
          }}
        >
          <DialogContent>
            {renderFraction === null ? (
              <>
                <DialogHeader>
                  <DialogTitle>Render video</DialogTitle>
                  <DialogDescription>
                    The render is saved to your library as a new clip.
                  </DialogDescription>
                </DialogHeader>
                <DialogBody className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="render-resolution" className="text-xs">
                      Resolution
                    </FieldLabel>
                    <Select
                      value={renderSettings.resolution}
                      onValueChange={(value) => {
                        const resolution = RENDER_RESOLUTIONS.find(
                          (entry) => entry === value,
                        )
                        if (resolution) {
                          setRenderSettings({ ...renderSettings, resolution })
                        }
                      }}
                    >
                      <SelectTrigger
                        id="render-resolution"
                        size="sm"
                        className="w-full"
                      >
                        <SelectValue>
                          {RESOLUTION_LABELS[renderSettings.resolution]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        {RENDER_RESOLUTIONS.map((resolution) => (
                          <SelectItem key={resolution} value={resolution}>
                            {RESOLUTION_LABELS[resolution]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="render-fps" className="text-xs">
                      Frame rate
                    </FieldLabel>
                    <Select
                      value={String(renderSettings.fps)}
                      onValueChange={(value) => {
                        const fps = RENDER_FPS_OPTIONS.find(
                          (entry) => String(entry) === value,
                        )
                        if (fps) setRenderSettings({ ...renderSettings, fps })
                      }}
                    >
                      <SelectTrigger
                        id="render-fps"
                        size="sm"
                        className="w-full"
                      >
                        <SelectValue>{renderSettings.fps} FPS</SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        {RENDER_FPS_OPTIONS.map((fps) => (
                          <SelectItem key={fps} value={String(fps)}>
                            {fps} FPS
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="render-codec" className="text-xs">
                      Codec
                    </FieldLabel>
                    <Select
                      value={renderSettings.codec}
                      disabled={renderCodecs === null}
                      onValueChange={(value) => {
                        const codec = (renderCodecs ?? []).find(
                          (entry) => entry === value,
                        )
                        if (codec) {
                          setRenderSettings({ ...renderSettings, codec })
                        }
                      }}
                    >
                      <SelectTrigger
                        id="render-codec"
                        size="sm"
                        className="w-full"
                      >
                        <SelectValue>
                          {renderCodecs === null
                            ? "Checking encoders..."
                            : CODEC_LABELS[renderSettings.codec]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        {(renderCodecs ?? []).map((codec) => (
                          <SelectItem key={codec} value={codec}>
                            {CODEC_LABELS[codec]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="render-quality" className="text-xs">
                      Quality
                    </FieldLabel>
                    <Select
                      value={renderSettings.quality}
                      onValueChange={(value) => {
                        const quality = RENDER_QUALITIES.find(
                          (entry) => entry === value,
                        )
                        if (quality) {
                          setRenderSettings({ ...renderSettings, quality })
                        }
                      }}
                    >
                      <SelectTrigger
                        id="render-quality"
                        size="sm"
                        className="w-full"
                      >
                        <SelectValue>
                          {QUALITY_LABELS[renderSettings.quality]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        {RENDER_QUALITIES.map((quality) => (
                          <SelectItem key={quality} value={quality}>
                            {QUALITY_LABELS[quality]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field className="col-span-2">
                    <FieldLabel
                      htmlFor="render-acceleration"
                      className="text-xs"
                    >
                      Encoder
                    </FieldLabel>
                    <Select
                      value={renderSettings.acceleration}
                      onValueChange={(value) => {
                        const acceleration = RENDER_ACCELERATIONS.find(
                          (entry) => entry === value,
                        )
                        if (acceleration) {
                          setRenderSettings({ ...renderSettings, acceleration })
                        }
                      }}
                    >
                      <SelectTrigger
                        id="render-acceleration"
                        size="sm"
                        className="w-full"
                      >
                        <SelectValue>
                          {ACCELERATION_LABELS[renderSettings.acceleration]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        {RENDER_ACCELERATIONS.map((acceleration) => (
                          <SelectItem key={acceleration} value={acceleration}>
                            {ACCELERATION_LABELS[acceleration]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </DialogBody>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setRenderDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={
                      renderCodecs !== null && renderCodecs.length === 0
                    }
                    onClick={() => {
                      void startRender()
                    }}
                  >
                    Start render
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Rendering video</DialogTitle>
                  <DialogDescription>
                    Decoding, compositing, and encoding your timeline. Keep the
                    app open.
                  </DialogDescription>
                </DialogHeader>
                <DialogBody className="flex flex-col gap-3">
                  <Progress value={Math.round(renderFraction * 100)} />
                  <span className="text-foreground-muted text-sm tabular-nums">
                    {Math.round(renderFraction * 100)}%
                  </span>
                </DialogBody>
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={cancelRender}>
                    Cancel
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* ── Stage: library panel + preview ── */}
        {snapshot ? (
          <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] gap-3">
            <EditorMediaPanel items={mediaItems} onAdd={addFromLibrary} />
            <EditorPreview
              project={project}
              sources={sources}
              currentMs={currentMs}
              playing={playing}
              onTogglePlay={togglePlayback}
              className="h-full"
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="size-6" />
          </div>
        )}

        {/* ── Transport ── */}
        <div className="border-border bg-surface-raised/50 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-md border px-2 py-1.5">
          <div className="flex items-center gap-1">
            <TransportButton
              label="Split at playhead (S)"
              disabled={!canSplit}
              onClick={splitAtPlayhead}
            >
              <ScissorsIcon />
            </TransportButton>
            <TransportButton
              label="Delete clip (Del)"
              disabled={!selectedClip}
              onClick={deleteSelected}
            >
              <Trash2Icon />
            </TransportButton>
            <TransportButton
              label="Add track"
              onClick={() => history.apply(addTrack(project))}
            >
              <PlusIcon />
            </TransportButton>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              aria-label={playing ? "Pause (Space)" : "Play (Space)"}
              title={playing ? "Pause (Space)" : "Play (Space)"}
              disabled={project.clips.length === 0}
              onClick={togglePlayback}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </Button>
            <span className="text-foreground-muted text-sm tabular-nums">
              {formatTrimMs(Math.min(currentMs, totalMs))} /{" "}
              {formatTrimMs(totalMs)}
            </span>
          </div>

          <div className="flex items-center justify-end gap-1">
            <TransportButton
              label="Undo (Ctrl+Z)"
              disabled={!history.canUndo}
              onClick={history.undo}
            >
              <Undo2Icon />
            </TransportButton>
            <TransportButton
              label="Redo (Ctrl+Shift+Z)"
              disabled={!history.canRedo}
              onClick={history.redo}
            >
              <Redo2Icon />
            </TransportButton>
            <TransportButton
              label="Zoom out (Ctrl+Scroll)"
              disabled={zoom <= 1}
              onClick={() => setZoom(clampTimelineZoom(zoom / ZOOM_STEP))}
            >
              <ZoomOutIcon />
            </TransportButton>
            <TransportButton
              label="Zoom in (Ctrl+Scroll)"
              disabled={zoom >= MAX_TIMELINE_ZOOM}
              onClick={() => setZoom(clampTimelineZoom(zoom * ZOOM_STEP))}
            >
              <ZoomInIcon />
            </TransportButton>
          </div>
        </div>

        {/* ── Timeline: up to three tracks tall, then it scrolls like a
            list instead of squeezing the preview above. ── */}
        <div
          className="shrink-0 overflow-y-auto"
          style={{
            maxHeight: `${3 + 4.25 * Math.min(project.tracks.length, 3)}rem`,
          }}
        >
          <MultitrackTimeline
            project={project}
            sources={sources}
            spanMs={spanMs}
            selectedClipId={selectedClipId}
            currentMs={currentMs}
            playing={playing}
            zoom={zoom}
            onZoomChange={(next) => setZoom(clampTimelineZoom(next))}
            onSeek={seek}
            onSelectClip={setSelectedClipId}
            onMoveClip={(clipId, trackId, desiredStartMs) => {
              history.update(moveClip(project, clipId, trackId, desiredStartMs))
            }}
            onTrimClipStart={(clipId, timelineMs) => {
              history.update(trimClipStart(project, clipId, timelineMs))
            }}
            onTrimClipEnd={(clipId, timelineMs) => {
              history.update(trimClipEnd(project, clipId, timelineMs))
            }}
            onToggleTransition={(leftClipId, rightClipId) => {
              history.apply(toggleTransition(project, leftClipId, rightClipId))
            }}
            onRemoveTrack={(trackId) => {
              history.apply(removeTrack(project, trackId))
            }}
            onEditBegin={() => {
              setFrozenSpanMs(spanMs)
              history.beginEdit()
            }}
            onEditCommit={() => {
              setFrozenSpanMs(null)
              history.commitEdit()
            }}
          />
        </div>
      </section>
    </AppMain>
  )
}

/**
 * The project title, styled like a route heading. Hovering reveals a pencil
 * affordance; clicking (or focusing) swaps in an inline field. Enter or blur
 * commits, Escape reverts, and an empty value falls back to the default name.
 */
function EditableProjectName({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (!editing) return
    const input = inputRef.current
    input?.focus()
    input?.select()
  }, [editing])

  const beginEdit = () => {
    setDraft(value)
    setEditing(true)
  }

  const commit = () => {
    const next = draft.trim()
    onChange(next.length > 0 ? next : DEFAULT_PROJECT_NAME)
    setEditing(false)
  }

  // The icon stays put and only the text node swaps in place, so the row keeps
  // identical box metrics whether resting or editing — no vertical jump. The
  // input carries no border or padding of its own for the same reason.
  return (
    <SectionTitle className="group min-w-0">
      <ClapperboardIcon className="text-accent" />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              commit()
            } else if (event.key === "Escape") {
              event.preventDefault()
              setEditing(false)
            }
          }}
          aria-label="Project name"
          className="field-sizing-content max-w-full min-w-[6ch] border-0 bg-transparent p-0 text-xl leading-7 font-semibold tracking-[-0.02em] text-inherit outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={beginEdit}
          title="Rename project"
          className="flex min-w-0 items-center gap-2"
        >
          <span className="truncate">{value}</span>
          <PencilIcon className="text-foreground-faint size-4! shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
    </SectionTitle>
  )
}

/** Slugs the project name into a safe capture filename, with a dated fallback. */
function renderFileName(projectName: string, timestamp: string): string {
  const slug = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug.length > 0 ? `${slug}-${timestamp}` : `alloy-render-${timestamp}`
}

function projectDraftSignature(
  title: string,
  project: RecordingLibraryProject | EditorProject,
): string {
  return JSON.stringify({ title: title.trim(), project })
}

function TransportButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/**
 * The clip a split applies to: the selected clip when the playhead is
 * inside it, otherwise the topmost clip under the playhead.
 */
function splitTarget(
  project: EditorProject,
  selectedClipId: string | null,
  currentMs: number,
) {
  const selected = selectedClipId ? findClip(project, selectedClipId) : null
  if (
    selected &&
    currentMs > selected.startMs &&
    currentMs < clipEndMs(selected)
  ) {
    return selected
  }
  return clipAtTimelineMs(project, currentMs)
}

function mediaSourceFor(item: RecordingLibraryItem): EditorMediaSource {
  return {
    id: item.id,
    label: item.title,
    mediaUrl: item.mediaUrl,
    frames: item.filmstripFrameUrls,
    durationMs: item.durationMs ?? 0,
    width: item.width,
    height: item.height,
  }
}

function cloudSourceFor(row: ClipRow): EditorMediaSource {
  return {
    id: row.id,
    label: row.title,
    mediaUrl: clipStreamUrl(row.id, "source", apiOrigin()),
    frames: [],
    durationMs: row.durationMs ?? 0,
    width: row.width,
    height: row.height,
    cloud: true,
  }
}

function localMediaItem(item: RecordingLibraryItem): EditorMediaItem {
  return {
    id: item.id,
    title: item.title,
    subtitle: item.groupLabel,
    durationMs: item.durationMs,
    thumbnailUrl: item.thumbnailUrl,
    searchText: item.fileName,
    cloud: false,
  }
}

function cloudMediaItem(row: ClipRow): EditorMediaItem {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.gameRef?.name ?? row.game ?? "Uploaded",
    durationMs: row.durationMs,
    thumbnailUrl: row.thumbKey
      ? clipThumbnailUrl(row.id, apiOrigin(), row.updatedAt)
      : null,
    searchText: row.description ?? "",
    cloud: true,
  }
}
