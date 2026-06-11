import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@alloy/ui/components/alert-dialog"
import { AppMain } from "@alloy/ui/components/app-shell"
import { Button } from "@alloy/ui/components/button"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { toast } from "@alloy/ui/lib/toast"
import { useNavigate } from "@tanstack/react-router"
import {
  ClapperboardIcon,
  HardDriveIcon,
  PauseIcon,
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

import { useLibrarySnapshot } from "@/components/routes/library/library-data"
import { LibraryEmpty } from "@/components/routes/library/library-page"
import {
  alloyDesktop,
  type AlloyDesktop,
  type RecordingLibraryProject,
} from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"
import { formatTrimMs } from "@/lib/media-time"

import { useEditorMedia } from "./editor-media-items"
import { type EditorMediaItem, EditorMediaPanel } from "./editor-media-panel"
import {
  DEFAULT_PROJECT_NAME,
  EditableProjectName,
  TransportButton,
} from "./editor-page-controls"
import { EditorPreview } from "./editor-preview"
import {
  addClip,
  addTrack,
  clipAtTimelineMs,
  clipEndMs,
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
import { EditorRenderDialog, useEditorRender } from "./editor-render-dialog"
import {
  clampTimelineZoom,
  MAX_TIMELINE_ZOOM,
  MultitrackTimeline,
} from "./editor-timeline"
import { useEditorHistory } from "./use-editor-history"
import { useEditorShortcuts } from "./use-editor-shortcuts"

const ZOOM_STEP = 1.5
/** Span padding so there's always room to drag clips toward the right. */
const SPAN_QUANTUM_MS = 30_000

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
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const currentMsRef = React.useRef(0)
  const loadedDraftIdRef = React.useRef<string | null>(null)
  const lastSavedSignatureRef = React.useRef<string | null>(null)

  const { mediaItems, sources } = useEditorMedia(snapshot)

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

  const deleteDraft = React.useCallback(async () => {
    if (!savedDraftId || deleting) return
    setDeleting(true)
    try {
      await desktop.recording.deleteLibraryProjectDraft(savedDraftId)
      toast.success("Project deleted")
      void refresh()
      void navigate({ to: "/library", replace: true })
    } catch (cause) {
      setDeleting(false)
      toast.error(errorMessage(cause, "Couldn't delete the project"))
    }
  }, [desktop, deleting, navigate, refresh, savedDraftId])

  /* ── Keyboard shortcuts ── */

  useEditorShortcuts({
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

  /* ── Render & save to the library ── */

  const render = useEditorRender({
    desktop,
    project,
    sources,
    projectName,
    onBeforeOpen: () => setPlaying(false),
  })

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
          {savedDraftId ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={deleting || draftSaveStatus === "saving"}
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2Icon />
              Delete
            </Button>
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
            disabled={project.clips.length === 0 || render.dialogOpen}
            onClick={render.openDialog}
          >
            <ClapperboardIcon />
            Render video
          </Button>
        </div>

        {/* ── Render: settings first, then modal progress. ── */}
        <EditorRenderDialog render={render} />

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this project?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the saved draft from your library. This can't be
                undone. Your source captures aren't affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  void deleteDraft()
                }}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete project"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
          <LoadingState className="flex-1 py-0" />
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

function projectDraftSignature(
  title: string,
  project: RecordingLibraryProject | EditorProject,
): string {
  return JSON.stringify({ title: title.trim(), project })
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
