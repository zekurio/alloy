import type {
  RecordingEvent,
  RecordingSettings,
  RecordingStatus,
} from "alloy-contracts"
import { Button } from "alloy-ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "alloy-ui/components/popover"
import { Switch } from "alloy-ui/components/switch"
import { cn } from "alloy-ui/lib/utils"
import { Gamepad2Icon, MonitorIcon, SettingsIcon } from "lucide-react"
import * as React from "react"

import { alloyDesktop } from "@/lib/desktop"

export function DesktopRecordingStatus() {
  const desktop = alloyDesktop()
  const recording = desktop?.recording ?? null
  const [settings, setSettings] = React.useState<RecordingSettings | null>(null)
  const [status, setStatus] = React.useState<RecordingStatus | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!recording) return

    let cancelled = false
    const unsubscribe = recording.onEvent((event: RecordingEvent) => {
      if (!cancelled && "status" in event) setStatus(event.status)
    })

    void Promise.all([recording.getSettings(), recording.getStatus()]).then(
      ([nextSettings, nextStatus]) => {
        if (cancelled) return
        setSettings(nextSettings)
        setStatus(nextStatus)
      },
    )

    const interval = setInterval(() => {
      void recording.getStatus().then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus)
      })
    }, 2000)

    return () => {
      cancelled = true
      clearInterval(interval)
      unsubscribe()
    }
  }, [recording])

  if (!desktop || !recording) return null

  const label = statusLabel(settings, status)
  const desktopMode = settings?.recordDesktop === true
  const sessionEnabled =
    settings?.recordDesktop === false && settings.triggerMode === "session"

  async function save(next: RecordingSettings) {
    if (!recording) return
    setBusy(true)
    setSettings(next)
    try {
      const saved = await recording.setSettings(next)
      setSettings(saved)
      setStatus(await recording.getStatus())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            title="Desktop recording status"
            className="hidden h-9 min-w-0 gap-2 rounded-md px-2.5 md:inline-flex"
          >
            {desktopMode ? (
              <MonitorIcon className="size-4 shrink-0" />
            ) : (
              <Gamepad2Icon className="size-4 shrink-0" />
            )}
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                status?.mode !== "idle" ? "bg-accent" : "bg-foreground-dim",
              )}
            />
            <span className="max-w-32 truncate text-sm font-semibold">
              {label}
            </span>
          </Button>
        }
      />
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="bg-surface-raised w-80 max-w-[calc(100vw-1.5rem)] gap-0 border p-0 ring-0"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 px-3 pt-3 pb-4">
            <div className="text-sm font-semibold">Record with Alloy</div>
            <div className="text-foreground-dim mt-0.5 truncate text-xs">
              {label}
            </div>
          </div>
          {settings ? (
            <Switch
              className="mt-3 mr-3"
              checked={settings.enabled}
              disabled={busy}
              onCheckedChange={(enabled) => void save({ ...settings, enabled })}
            />
          ) : null}
        </div>

        <div className="border-border flex flex-col gap-3 border-t px-3 py-4">
          <HeaderToggle
            title="Desktop capture"
            description="Replay buffer only"
            checked={desktopMode}
            disabled={!settings || busy}
            onCheckedChange={(recordDesktop) => {
              if (!settings) return
              void save({
                ...settings,
                recordDesktop,
                triggerMode: recordDesktop
                  ? "replay-buffer"
                  : settings.triggerMode,
              })
            }}
          />
          <HeaderToggle
            title="Session recording"
            description="Smart game capture only"
            checked={sessionEnabled}
            disabled={!settings || busy || desktopMode}
            onCheckedChange={(checked) => {
              if (!settings) return
              void save({
                ...settings,
                recordDesktop: false,
                triggerMode: checked ? "session" : "replay-buffer",
              })
            }}
          />
        </div>

        <div className="border-border flex items-center border-t px-3 py-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-foreground-muted px-2"
            onClick={() => void desktop.openSettings()}
          >
            <SettingsIcon className="size-4" />
            Settings
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function HeaderToggle({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string
  description: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-foreground-dim text-xs">{description}</div>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

function statusLabel(
  settings: RecordingSettings | null,
  status: RecordingStatus | null,
): string {
  if (!settings) return "Loading Capture"
  if (!settings.enabled) return "Recording Off"
  if (settings.recordDesktop) {
    return status?.mode === "replay-buffer" ? "Desktop Replay" : "Desktop Ready"
  }
  if (status?.mode === "recording") return status.activeGame ?? "Recording"
  if (status?.mode === "replay-buffer") {
    return status.activeGame ? `${status.activeGame} Replay` : "Game Replay"
  }
  return status?.activeGame ?? "Waiting For Game"
}
