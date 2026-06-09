import type {
  RecordingSettings,
  RecordingStatus,
  RecordingTriggerMode,
} from "alloy-contracts"
import { Switch } from "alloy-ui/components/switch"
import { cn } from "alloy-ui/lib/utils"
import { CheckIcon, ClapperboardIcon, RotateCcwIcon } from "lucide-react"
import { type ReactNode } from "react"

const MODE_OPTIONS: Array<{
  id: RecordingTriggerMode
  label: string
  description: string
  icon: ReactNode
}> = [
  {
    id: "replay-buffer",
    label: "Replay clips",
    description: "Keep a rolling buffer and save clips with the hotkey.",
    icon: <RotateCcwIcon className="size-3.5" />,
  },
  {
    id: "session",
    label: "Save full sessions",
    description: "Save the whole allowed game session to disk.",
    icon: <ClapperboardIcon className="size-3.5" />,
  },
]

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
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Record with Alloy</div>
            <p className="text-foreground-dim mt-0.5 text-xs">
              Capture starts when Alloy detects a game.
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
            "border-border mt-3 flex items-center gap-2 border-t pt-3 text-xs",
            settings.enabled ? "text-foreground-muted" : "text-foreground-dim",
          )}
        >
          <div
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              status.mode !== "idle" ? "bg-accent" : "bg-foreground-dim",
            )}
          />
          <span className="font-medium">
            {status.activeGame
              ? `${status.activeGame} is ${status.mode === "idle" ? "ready" : "recording"}`
              : settings.enabled
                ? "Waiting for a game"
                : "Recording is off"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {MODE_OPTIONS.map((mode) => (
          <ModeCard
            key={mode.id}
            label={mode.label}
            description={mode.description}
            icon={mode.icon}
            active={settings.triggerMode === mode.id}
            disabled={busy}
            onSelect={() => void save({ ...settings, triggerMode: mode.id })}
          />
        ))}
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

function ModeCard({
  label,
  description,
  icon,
  active,
  disabled,
  onSelect,
}: {
  label: string
  description: string
  icon: ReactNode
  active: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "relative flex min-h-20 flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-accent-border bg-accent/5"
          : "border-border hover:border-border-strong hover:bg-white/[0.03]",
        disabled && "opacity-60",
      )}
    >
      <span className="flex items-center gap-1.5 pr-5 text-sm font-semibold">
        {icon}
        {label}
      </span>
      <span className="text-foreground-dim text-xs leading-snug">
        {description}
      </span>
      {active ? (
        <CheckIcon className="text-accent absolute top-2 right-2 size-3.5" />
      ) : null}
    </button>
  )
}
