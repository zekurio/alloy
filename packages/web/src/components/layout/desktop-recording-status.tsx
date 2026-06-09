import type {
  RecordingEvent,
  RecordingSettings,
  RecordingStatus,
} from "alloy-contracts"
import { Button } from "alloy-ui/components/button"
import { GameIcon } from "alloy-ui/components/game-icon"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "alloy-ui/components/popover"
import { Switch } from "alloy-ui/components/switch"
import { toast } from "alloy-ui/lib/toast"
import { cn } from "alloy-ui/lib/utils"
import { SettingsIcon } from "lucide-react"
import * as React from "react"

import { alloyDesktop } from "@/lib/desktop"

export function DesktopRecordingStatus() {
  const desktop = alloyDesktop()
  const recording = desktop?.recording ?? null
  const [settings, setSettings] = React.useState<RecordingSettings | null>(null)
  const [status, setStatus] = React.useState<RecordingStatus | null>(null)
  const saveSequence = React.useRef(0)

  React.useEffect(() => {
    if (!recording) return

    let cancelled = false
    let receivedSettingsEvent = false
    let receivedStatusEvent = false
    const unsubscribe = recording.onEvent((event: RecordingEvent) => {
      if (cancelled) return
      if (event.type === "settings") {
        receivedSettingsEvent = true
        setSettings(event.settings)
      }
      if ("status" in event) {
        receivedStatusEvent = true
        setStatus(event.status)
      }
    })

    void Promise.all([recording.getSettings(), recording.getStatus()]).then(
      ([nextSettings, nextStatus]) => {
        if (cancelled) return
        if (!receivedSettingsEvent) setSettings(nextSettings)
        if (!receivedStatusEvent) setStatus(nextStatus)
      },
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [recording])

  if (!desktop || !recording) return null

  const label = statusLabel(settings, status)
  const active = statusActive(settings, status)
  const activeGame = status?.activeGameDetail
  const sessionEnabled = settings?.triggerMode === "session"

  async function save(next: RecordingSettings) {
    if (!recording) return
    const previous = settings
    const sequence = ++saveSequence.current
    setSettings(next)
    try {
      const saved = await recording.setSettings(next)
      if (sequence !== saveSequence.current) return
      setSettings(saved)
    } catch (cause) {
      if (sequence !== saveSequence.current) return
      setSettings(previous)
      toast.error(errorText(cause, "Couldn't save recording settings."))
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
            title="Game recording status"
            className="hidden h-9 min-w-0 gap-2 rounded-md px-2.5 md:inline-flex"
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                active ? "bg-accent" : "bg-foreground-dim",
              )}
            />
            {activeGame ? (
              <GameIcon
                src={activeGame.iconUrl}
                name={activeGame.name}
                className="size-4"
              />
            ) : null}
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
        className="alloy-blur w-80 max-w-[calc(100vw-1.5rem)] gap-0 border p-0 ring-0"
        style={
          {
            "--alloy-blur-opacity": "78%",
            "--alloy-blur-blur": "32px",
            "--alloy-blur-shadow": "0 30px 80px -32px rgb(0 0 0 / 0.78)",
          } as React.CSSProperties
        }
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
              onCheckedChange={(enabled) => void save({ ...settings, enabled })}
            />
          ) : null}
        </div>

        <div className="border-border flex flex-col gap-3 border-t px-3 py-4">
          <HeaderToggle
            title="Session recording"
            description="Detected games only"
            checked={sessionEnabled}
            disabled={!settings}
            onCheckedChange={(checked) => {
              if (!settings) return
              void save({
                ...settings,
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
  return status?.activeGame ?? "Waiting for game"
}

function statusActive(
  settings: RecordingSettings | null,
  status: RecordingStatus | null,
): boolean {
  if (!settings?.enabled) return false
  return Boolean(status?.activeGame)
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
