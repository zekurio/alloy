import type { RecordingSettings, RecordingStatus } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Switch } from "@alloy/ui/components/switch"
import { cn } from "@alloy/ui/lib/utils"

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
          <div className="text-sm font-semibold">{t("Capture with Alloy")}</div>
          <p className="text-foreground-dim mt-0.5 text-xs">
            {t(
              "Auto-detect a game or display and keep the replay buffer ready.",
            )}
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
          status.replayActive ? "text-foreground-muted" : "text-foreground-dim",
        )}
      >
        <div
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            status.replayActive ? "bg-accent" : "bg-foreground-dim",
          )}
        />
        <span className="font-medium">
          {captureStatusLabel(settings, status)}
        </span>
      </div>
    </div>
  )
}

function captureStatusLabel(
  settings: RecordingSettings,
  status: RecordingStatus,
): string {
  if (status.replayActive) return t("Replay buffer active")
  if (settings.captureMode === "display") {
    return settings.enabled
      ? t("Display capture ready")
      : t("Display capture off")
  }
  if (!settings.enabled) return t("Capture is off")
  return status.activeGame
    ? t("{game} is ready", { game: status.activeGame })
    : t("Waiting for a game")
}
