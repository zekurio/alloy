import { cn } from "@alloy/ui/lib/utils"
import { ClapperboardIcon } from "lucide-react"
import * as React from "react"

import { PreviewEngine } from "./editor-playback"
import type { EditorMediaSource, EditorProject } from "./editor-project"

/**
 * Arrangement preview backed by the mediabunny engine: a canvas the engine
 * composites decoded frames onto, with audio scheduled on its own
 * AudioContext. The page's clock owns timeline time — this component just
 * forwards it, so cuts swap frames instantly and crossfades blend instead
 * of the old per-cut video-element reload (which blacked out).
 */
export function EditorPreview({
  project,
  sources,
  currentMs,
  playing,
  onTogglePlay,
  className,
}: {
  project: EditorProject
  sources: Map<string, EditorMediaSource>
  /** Playhead position in timeline time. */
  currentMs: number
  playing: boolean
  onTogglePlay: () => void
  className?: string
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const engineRef = React.useRef<PreviewEngine | null>(null)
  const currentMsRef = React.useRef(currentMs)
  currentMsRef.current = currentMs
  const stateRef = React.useRef({ project, sources, playing })
  stateRef.current = { project, sources, playing }
  const [engineError, setEngineError] = React.useState<string | null>(null)
  const empty = project.clips.length === 0

  // The engine lives for one mount (StrictMode re-mounts get a fresh one).
  React.useEffect(() => {
    const engine = new PreviewEngine()
    engineRef.current = engine
    engine.onError = (message) => setEngineError(message)
    if (canvasRef.current) engine.attach(canvasRef.current)
    const { project: p, sources: s, playing: isPlaying } = stateRef.current
    engine.setProject(p, s)
    if (isPlaying) engine.play(currentMsRef.current)
    else void engine.drawStatic(currentMsRef.current)
    return () => {
      engineRef.current = null
      engine.dispose()
    }
  }, [])

  React.useEffect(() => {
    engineRef.current?.setProject(project, sources)
  }, [project, sources])

  React.useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (playing) engine.play(currentMsRef.current)
    else engine.pause()
  }, [playing])

  // Per-tick drive: the page advances currentMs on every animation frame
  // while playing; paused changes (scrubs, edits) decode statically.
  React.useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (playing) engine.renderFrame(currentMs)
    else void engine.drawStatic(currentMs)
  }, [playing, currentMs, project, sources])

  return (
    <div
      className={cn(
        "relative flex min-h-0 items-center justify-center overflow-hidden rounded-md bg-black",
        className,
      )}
      onClick={onTogglePlay}
    >
      <canvas
        ref={canvasRef}
        className={cn("size-full object-contain", empty && "opacity-0")}
      />
      {empty ? (
        <div className="text-foreground-faint pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm">
          <ClapperboardIcon className="size-8" />
          Add clips from the library to start editing
        </div>
      ) : null}
      {engineError ? (
        <p className="text-danger pointer-events-none absolute inset-x-2 bottom-2 rounded-md bg-black/70 px-2 py-1 text-center text-xs">
          {engineError}
        </p>
      ) : null}
    </div>
  )
}
