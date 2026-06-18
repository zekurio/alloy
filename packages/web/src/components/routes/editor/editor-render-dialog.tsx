import { t as tx } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import { Field, FieldLabel } from "@alloy/ui/components/field"
import { Progress } from "@alloy/ui/components/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { toast } from "@alloy/ui/lib/toast"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import * as React from "react"

import { refreshLibrarySnapshotCache } from "@/components/routes/library/library-data"
import type { AlloyDesktop } from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"

import type { EditorMediaSource, EditorProject } from "./editor-project"
import { renderProject } from "./editor-render"
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
  type RenderSettings,
} from "./editor-render-settings"

const CODEC_LABELS: Record<RenderCodec, string> = {
  avc: tx("H.264 (AVC)"),
  hevc: tx("H.265 (HEVC)"),
  vp9: tx("VP9"),
  av1: tx("AV1"),
}
const RESOLUTION_LABELS: Record<RenderResolution, string> = {
  source: tx("Source resolution"),
  "1440": "1440p",
  "1080": "1080p",
  "720": "720p",
}
const QUALITY_LABELS: Record<RenderQuality, string> = {
  medium: tx("Medium"),
  high: tx("High"),
  "very-high": tx("Very high"),
}
const ACCELERATION_LABELS: Record<RenderAcceleration, string> = {
  auto: tx("Auto"),
  gpu: tx("GPU (hardware)"),
  cpu: tx("CPU (software)"),
}

export interface EditorRenderController {
  dialogOpen: boolean
  openDialog: () => void
  onOpenChange: (open: boolean) => void
  settings: RenderSettings
  setSettings: (settings: RenderSettings) => void
  /** Null until probed; the codec select shows what this machine encodes. */
  codecs: RenderCodec[] | null
  fraction: number | null
  start: () => Promise<void>
  cancel: () => void
  close: () => void
}

/**
 * Render-to-library state and actions for the editor page: dialog
 * visibility, settings, the encodable-codec probe, progress, and the
 * render/save/cancel flow.
 */
export function useEditorRender({
  desktop,
  project,
  sources,
  projectName,
  onBeforeOpen,
}: {
  desktop: AlloyDesktop
  project: EditorProject
  sources: Map<string, EditorMediaSource>
  projectName: string
  /** Runs as the dialog opens (the page pauses playback). */
  onBeforeOpen: () => void
}): EditorRenderController {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
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
    onBeforeOpen()
    setRenderDialogOpen(true)
    if (renderCodecs === null) {
      void encodableRenderCodecs()
        .then((codecs) => {
          setRenderCodecs(codecs)
          // Drop an unencodable default (e.g. no AV1 encoder).
          setRenderSettings((current) =>
            codecs.length > 0 && !codecs.includes(current.codec)
              ? { ...current, codec: codecs[0] }
              : current,
          )
        })
        .catch((cause) => {
          toast.error(errorMessage(cause, tx("Couldn't probe video encoders")))
          setRenderCodecs([])
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
      await refreshLibrarySnapshotCache(queryClient, desktop)
      toast.success(tx("Render saved to your library"))
      setRenderDialogOpen(false)
      void navigate({
        to: "/library/$captureId",
        params: { captureId: saved.id },
      })
    } catch (cause) {
      if (!abort.signal.aborted) {
        toast.error(errorMessage(cause, tx("Couldn't render the project")))
      }
    } finally {
      renderAbortRef.current = null
      setRenderFraction(null)
    }
  }

  const cancelRender = () => {
    renderAbortRef.current?.abort()
  }

  return {
    dialogOpen: renderDialogOpen,
    openDialog: openRenderDialog,
    onOpenChange: (open) => {
      // No dismissing mid-render; Cancel aborts instead.
      if (!open && renderFraction === null) setRenderDialogOpen(false)
    },
    settings: renderSettings,
    setSettings: setRenderSettings,
    codecs: renderCodecs,
    fraction: renderFraction,
    start: startRender,
    cancel: cancelRender,
    close: () => setRenderDialogOpen(false),
  }
}

/** Render-to-library dialog: settings first, then modal progress. */
export function EditorRenderDialog({
  render,
}: {
  render: EditorRenderController
}) {
  const {
    settings: renderSettings,
    setSettings: setRenderSettings,
    codecs: renderCodecs,
    fraction: renderFraction,
  } = render

  return (
    <Dialog open={render.dialogOpen} onOpenChange={render.onOpenChange}>
      <DialogContent>
        {renderFraction === null ? (
          <>
            <DialogHeader>
              <DialogTitle>{tx("Render video")}</DialogTitle>
              <DialogDescription>
                {tx("The render is saved to your library as a new clip.")}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="render-resolution" className="text-xs">
                  {tx("Resolution")}
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
                  {tx("Frame rate")}
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
                  <SelectTrigger id="render-fps" size="sm" className="w-full">
                    <SelectValue>
                      {renderSettings.fps} {tx("FPS")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    {RENDER_FPS_OPTIONS.map((fps) => (
                      <SelectItem key={fps} value={String(fps)}>
                        {fps} {tx("FPS")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="render-codec" className="text-xs">
                  {tx("Codec")}
                </FieldLabel>
                <Select
                  value={renderSettings.codec}
                  disabled={renderCodecs === null || renderCodecs.length === 0}
                  onValueChange={(value) => {
                    const codec = (renderCodecs ?? []).find(
                      (entry) => entry === value,
                    )
                    if (codec) {
                      setRenderSettings({ ...renderSettings, codec })
                    }
                  }}
                >
                  <SelectTrigger id="render-codec" size="sm" className="w-full">
                    <SelectValue>
                      {renderCodecs === null
                        ? tx("Checking encoders...")
                        : renderCodecs.length === 0
                          ? tx("No encoders available")
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
                  {tx("Quality")}
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
                <FieldLabel htmlFor="render-acceleration" className="text-xs">
                  {tx("Encoder")}
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
              <Button type="button" variant="ghost" onClick={render.close}>
                {tx("Cancel")}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={renderCodecs !== null && renderCodecs.length === 0}
                onClick={() => {
                  void render.start()
                }}
              >
                {tx("Start render")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{tx("Rendering video")}</DialogTitle>
              <DialogDescription>
                {tx(
                  "Decoding, compositing, and encoding your timeline. Keep the app open.",
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-3">
              <Progress value={Math.round(renderFraction * 100)} />
              <span className="text-foreground-muted text-sm tabular-nums">
                {Math.round(renderFraction * 100)}
                {"%"}
              </span>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={render.cancel}>
                {tx("Cancel")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
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
