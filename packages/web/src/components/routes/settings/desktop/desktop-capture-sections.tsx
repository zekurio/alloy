import type { RecordingSettings, RecordingStatus } from "alloy-contracts"
import { Switch } from "alloy-ui/components/switch"
import { cn } from "alloy-ui/lib/utils"
import { type ReactNode } from "react"

export function ModeSection({
  settings,
  status,
  busy,
  save,
}: {
  settings: RecordingSettings
  status: RecordingStatus
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Record with Alloy</div>
          <p className="text-foreground-dim mt-0.5 text-xs">
            Auto-detect games and keep replay clips ready.
          </p>
        </div>
        <Switch
          checked={settings.enabled}
          disabled={busy}
          onCheckedChange={(enabled) => void save({ ...settings, enabled })}
        />
      </div>

      <div
        className={cn(
          "border-border bg-surface-raised/40 flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
          status.replayActive || status.longRecordingActive
            ? "text-foreground-muted"
            : "text-foreground-dim",
        )}
      >
        <div
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            status.replayActive || status.longRecordingActive
              ? "bg-accent"
              : "bg-foreground-dim",
          )}
        />
        <span className="font-medium">
          {captureStatusLabel(settings, status)}
        </span>
      </div>

      <div
        className={cn(
          "rounded-md border px-3 py-3",
          settings.longRecording.autoRecordGames
            ? "border-accent-border bg-accent/5"
            : "border-border bg-transparent",
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Auto long recordings</div>
            <p className="text-foreground-dim mt-0.5 text-xs">
              Record full detected game sessions until the game closes.
            </p>
          </div>
          <Switch
            checked={settings.longRecording.autoRecordGames}
            disabled={busy || settings.captureMode === "display"}
            onCheckedChange={(autoRecordGames) =>
              void save({
                ...settings,
                longRecording: {
                  ...settings.longRecording,
                  autoRecordGames,
                },
              })
            }
          />
        </div>
        {settings.captureMode === "display" ? (
          <p className="text-foreground-faint mt-2 text-xs">
            Desktop capture uses manual long recording only.
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function Subsection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-foreground text-sm font-semibold">{title}</h3>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function captureStatusLabel(
  settings: RecordingSettings,
  status: RecordingStatus,
): string {
  if (status.longRecordingActive) return "Long recording"
  if (status.replayActive) return "Replay active"
  if (settings.captureMode === "display") {
    return settings.enabled ? "Desktop capture ready" : "Desktop capture off"
  }
  if (!settings.enabled) return "Recording is off"
  return status.activeGame
    ? `${status.activeGame} is ready`
    : "Waiting for a game"
}
