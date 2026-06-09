import type {
  RecordingDisplay,
  RecordingEvent,
  RecordingSettings,
  RecordingStatus,
} from "alloy-contracts"
import { Button } from "alloy-ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "alloy-ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "alloy-ui/components/dropdown-menu"
import { GameIcon } from "alloy-ui/components/game-icon"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "alloy-ui/components/popover"
import { Switch } from "alloy-ui/components/switch"
import { toast } from "alloy-ui/lib/toast"
import { cn } from "alloy-ui/lib/utils"
import {
  ArrowRightIcon,
  ChevronDownIcon,
  Gamepad2Icon,
  MicIcon,
  MonitorIcon,
  Volume2Icon,
} from "lucide-react"
import * as React from "react"

import { alloyDesktop, type AlloyDesktopRecordingApi } from "@/lib/desktop"
import type { AlloyDesktop } from "@/lib/desktop"

type SaveRecordingSettings = (next: RecordingSettings) => Promise<void>

export function DesktopRecordingStatus() {
  const desktop = alloyDesktop()
  const recording = desktop?.recording ?? null
  const state = useDesktopRecordingState(recording)

  if (!desktop || !recording) return null

  return (
    <>
      <RecordingStatusPopover
        active={statusActive(state.status)}
        activeGame={state.status?.activeGameDetail ?? null}
        desktop={desktop}
        displays={state.displays}
        label={statusLabel(state.settings, state.status)}
        settings={state.settings}
        status={state.status}
        onOpenDisplayPicker={() => state.setDisplayPickerOpen(true)}
        onSave={state.save}
      />
      <DisplayPickerDialog
        displays={state.displays}
        loading={state.displayLoading}
        open={state.displayPickerOpen}
        onOpenChange={state.setDisplayPickerOpen}
        onSelect={state.selectDisplay}
      />
    </>
  )
}

function useDesktopRecordingState(recording: AlloyDesktopRecordingApi | null) {
  const [settings, setSettings] = React.useState<RecordingSettings | null>(null)
  const [status, setStatus] = React.useState<RecordingStatus | null>(null)
  const [displayPickerOpen, setDisplayPickerOpen] = React.useState(false)
  const [displays, setDisplays] = React.useState<RecordingDisplay[]>([])
  const [displayLoading, setDisplayLoading] = React.useState(false)
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

  React.useEffect(() => {
    if (!recording || !displayPickerOpen) return
    let cancelled = false
    setDisplayLoading(true)
    void recording
      .listDisplays()
      .then((nextDisplays) => {
        if (!cancelled) setDisplays(nextDisplays)
      })
      .catch((cause) =>
        toast.error(errorText(cause, "Couldn't load displays.")),
      )
      .finally(() => {
        if (!cancelled) setDisplayLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [displayPickerOpen, recording])

  React.useEffect(() => {
    if (!recording || settings?.captureMode !== "display") return
    if (displays.some((display) => display.thumbnailDataUrl)) return

    let cancelled = false
    void recording
      .listDisplays()
      .then((nextDisplays) => {
        if (!cancelled) setDisplays(nextDisplays)
      })
      .catch((cause) =>
        toast.error(errorText(cause, "Couldn't load display preview.")),
      )
    return () => {
      cancelled = true
    }
  }, [displays, recording, settings?.captureMode])

  const save = React.useCallback(
    async (next: RecordingSettings) => {
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
    },
    [recording, settings],
  )

  const selectDisplay = React.useCallback(
    (display: RecordingDisplay) => {
      if (!settings) return
      void save({
        ...settings,
        enabled: true,
        captureMode: "display",
        selectedDisplayId: display.id,
        longRecording: {
          ...settings.longRecording,
          autoRecordGames: false,
        },
      })
      setDisplayPickerOpen(false)
    },
    [save, settings],
  )

  return {
    displayLoading,
    displayPickerOpen,
    displays,
    save,
    selectDisplay,
    setDisplayPickerOpen,
    settings,
    status,
  }
}

function RecordingStatusPopover({
  active,
  activeGame,
  desktop,
  displays,
  label,
  settings,
  status,
  onOpenDisplayPicker,
  onSave,
}: {
  active: boolean
  activeGame: RecordingStatus["activeGameDetail"] | null
  desktop: AlloyDesktop
  displays: RecordingDisplay[]
  label: string
  settings: RecordingSettings | null
  status: RecordingStatus | null
  onOpenDisplayPicker: () => void
  onSave: SaveRecordingSettings
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Recording status"
            aria-label={`Recording status: ${label}`}
            className={cn(
              "hidden h-8 w-36 min-w-0 appearance-none items-center border-0 bg-transparent p-0 text-left outline-none md:inline-flex",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              active
                ? "text-foreground hover:text-foreground active:text-foreground focus:text-foreground data-open:text-foreground data-popup-open:text-foreground"
                : "text-foreground-muted hover:text-foreground-muted active:text-foreground-muted focus:text-foreground-muted data-open:text-foreground-muted data-popup-open:text-foreground-muted",
            )}
          >
            <span className="flex w-full min-w-0 items-center gap-1">
              {activeGame && settings?.captureMode !== "display" ? (
                <GameIcon
                  src={activeGame.iconUrl}
                  name={activeGame.name}
                  className="size-4"
                />
              ) : settings?.captureMode === "display" ? (
                <MonitorIcon className="text-foreground-muted size-4" />
              ) : (
                <Gamepad2Icon className="size-4 shrink-0 text-current" />
              )}
              <span className="min-w-0 truncate text-sm font-semibold">
                {label}
              </span>
            </span>
          </button>
        }
      />
      <PopoverContent
        align="center"
        side="bottom"
        sideOffset={8}
        className="alloy-blur w-[26rem] max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden border p-0 ring-0"
        style={
          {
            "--alloy-blur-opacity": "90%",
            "--alloy-blur-blur": "36px",
            "--alloy-blur-shadow": "0 30px 80px -32px rgb(0 0 0 / 0.78)",
          } as React.CSSProperties
        }
      >
        <RecordingStatusContent
          displays={displays}
          desktop={desktop}
          settings={settings}
          status={status}
          onOpenDisplayPicker={onOpenDisplayPicker}
          onSave={onSave}
        />
      </PopoverContent>
    </Popover>
  )
}

function RecordingStatusContent({
  displays,
  desktop,
  settings,
  status,
  onOpenDisplayPicker,
  onSave,
}: {
  displays: RecordingDisplay[]
  desktop: AlloyDesktop
  settings: RecordingSettings | null
  status: RecordingStatus | null
  onOpenDisplayPicker: () => void
  onSave: SaveRecordingSettings
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <div className="text-sm font-semibold">Record with Alloy</div>
        {settings ? (
          <div className="flex items-center gap-2">
            <span className="text-foreground-dim text-[10px] font-semibold tracking-wide uppercase">
              {settings.enabled ? "On" : "Off"}
            </span>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(enabled) =>
                void onSave({ ...settings, enabled })
              }
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 px-4 pb-4">
        <RecordingAudioSettings
          desktop={desktop}
          settings={settings}
          status={status}
          onSave={onSave}
        />
        <RecordingCaptureTarget
          displays={displays}
          settings={settings}
          status={status}
          onOpenDisplayPicker={onOpenDisplayPicker}
          onSave={onSave}
        />
      </div>

      <div className="border-border flex h-11 items-center border-t px-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-between px-2 text-sm font-medium"
          onClick={() => void desktop.openSettings()}
        >
          <span>Recording settings</span>
          <ArrowRightIcon className="text-foreground-dim size-4" />
        </Button>
      </div>
    </>
  )
}

function RecordingAudioSettings({
  desktop,
  settings,
  status,
  onSave,
}: {
  desktop: AlloyDesktop
  settings: RecordingSettings | null
  status: RecordingStatus | null
  onSave: SaveRecordingSettings
}) {
  const audioDevices = React.useMemo(
    () =>
      mergeAudioDevices(
        status?.availableAudioDevices ?? [],
        settings?.audioDevices ?? [],
      ),
    [settings?.audioDevices, status?.availableAudioDevices],
  )

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-foreground-dim text-xs font-semibold tracking-wide uppercase">
          Audio settings
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-accent h-7 px-1.5"
          onClick={() => void desktop.openSettings()}
        >
          Manage Audio
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>
      <AudioRow
        icon={<Volume2Icon className="size-4" />}
        label="Audio source"
        kind="output"
        devices={audioDevices}
        settings={settings}
        onSave={onSave}
      />
      <AudioRow
        icon={<MicIcon className="size-4" />}
        label="Microphone source"
        kind="input"
        devices={audioDevices}
        settings={settings}
        onSave={onSave}
      />
    </>
  )
}

function RecordingCaptureTarget({
  displays,
  settings,
  status,
  onOpenDisplayPicker,
  onSave,
}: {
  displays: RecordingDisplay[]
  settings: RecordingSettings | null
  status: RecordingStatus | null
  onOpenDisplayPicker: () => void
  onSave: SaveRecordingSettings
}) {
  const activeDisplay = selectedDisplay(settings, status, displays)

  return (
    <>
      <div
        className="alloy-blur relative flex h-24 overflow-hidden rounded-md border text-center"
        style={
          {
            "--alloy-blur-opacity": "58%",
            "--alloy-blur-blur": "24px",
            "--alloy-blur-shadow": "none",
          } as React.CSSProperties
        }
      >
        {settings?.captureMode === "display" &&
        activeDisplay?.thumbnailDataUrl ? (
          <>
            <img
              src={activeDisplay.thumbnailDataUrl}
              alt=""
              draggable={false}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2">
              <div className="truncate text-sm font-semibold">
                {captureTargetLabel(settings, status)}
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 py-4">
            {settings?.captureMode === "display" ? (
              <MonitorIcon className="text-foreground-muted size-5" />
            ) : (
              <Gamepad2Icon className="text-foreground-muted size-5" />
            )}
            <div className="text-foreground-muted text-sm font-semibold">
              {captureTargetLabel(settings, status)}
            </div>
          </div>
        )}
      </div>

      {settings?.captureMode === "display" ? (
        <Button
          type="button"
          variant="outline"
          className="border-danger/70 bg-danger/5 text-danger hover:border-danger hover:bg-danger/15 hover:text-danger h-9 w-full"
          onClick={() =>
            void onSave({
              ...settings,
              captureMode: "game",
              selectedDisplayId: "",
            })
          }
        >
          Stop Desktop Capture
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full"
          onClick={onOpenDisplayPicker}
        >
          <MonitorIcon className="size-4" />
          Switch to Desktop Capture
        </Button>
      )}
    </>
  )
}

function DisplayPickerDialog({
  displays,
  loading,
  open,
  onOpenChange,
  onSelect,
}: {
  displays: RecordingDisplay[]
  loading: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (display: RecordingDisplay) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="secondary" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose Display</DialogTitle>
          <DialogDescription>
            Select the display Alloy should use for desktop capture.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {loading ? (
            <div className="text-foreground-muted flex h-40 items-center justify-center text-sm">
              Loading displays
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {displays.map((display) => (
                <DisplayOption
                  key={display.id}
                  display={display}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function DisplayOption({
  display,
  onSelect,
}: {
  display: RecordingDisplay
  onSelect: (display: RecordingDisplay) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(display)}
      className="border-border hover:border-border-strong overflow-hidden rounded-md border text-left transition-colors hover:bg-white/[0.03]"
    >
      <div className="bg-black">
        {display.thumbnailDataUrl ? (
          <img
            src={display.thumbnailDataUrl}
            alt=""
            className="aspect-video w-full object-cover"
          />
        ) : (
          <div className="flex aspect-video items-center justify-center">
            <MonitorIcon className="text-foreground-dim size-8" />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{display.name}</div>
          <div className="text-foreground-dim text-xs">
            {display.width} x {display.height}
          </div>
        </div>
        {display.primary ? (
          <span className="bg-accent/10 text-accent rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase">
            Primary
          </span>
        ) : null}
      </div>
    </button>
  )
}

function AudioRow({
  icon,
  label,
  kind,
  devices,
  settings,
  onSave,
}: {
  icon: React.ReactNode
  label: string
  kind: "output" | "input"
  devices: RecordingSettings["audioDevices"]
  settings: RecordingSettings | null
  onSave: SaveRecordingSettings
}) {
  const options = devices.filter((device) => device.kind === kind)
  const selected = options.filter((device) => device.enabled)
  const disabled = !settings || options.length === 0

  return (
    <div className="flex items-center gap-3">
      <span className="text-foreground-muted">{icon}</span>
      <span className="min-w-36 flex-1 text-sm font-semibold">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              className="h-9 w-52 justify-between gap-2 px-3"
            >
              <span className="truncate">
                {audioDeviceMultiSelectLabel(selected, settings)}
              </span>
              <ChevronDownIcon className="text-foreground-dim size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-64">
          {options.map((device) => (
            <DropdownMenuCheckboxItem
              key={`${device.kind}:${device.id}`}
              checked={device.enabled}
              onCheckedChange={(checked) => {
                if (!settings) return
                void onSave({
                  ...settings,
                  audioDevices: toggleAudioDevice(settings.audioDevices, {
                    ...device,
                    enabled: checked === true,
                  }),
                })
              }}
            >
              <span className="truncate">{device.label}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function mergeAudioDevices(
  available: RecordingSettings["audioDevices"],
  selected: RecordingSettings["audioDevices"],
): RecordingSettings["audioDevices"] {
  const byKey = new Map<string, RecordingSettings["audioDevices"][number]>()

  for (const device of available) byKey.set(audioDeviceKey(device), device)
  for (const device of selected) {
    const key = audioDeviceKey(device)
    byKey.set(key, {
      ...(byKey.get(key) ?? device),
      enabled: device.enabled,
      volume: device.volume,
    })
  }

  return [...byKey.values()]
}

function toggleAudioDevice(
  current: RecordingSettings["audioDevices"],
  device: RecordingSettings["audioDevices"][number],
): RecordingSettings["audioDevices"] {
  const key = audioDeviceKey(device)
  const existing = current.find((item) => audioDeviceKey(item) === key)
  return [
    ...current.filter((item) => audioDeviceKey(item) !== key),
    {
      ...device,
      volume: existing?.volume ?? device.volume,
    },
  ]
}

function audioDeviceMultiSelectLabel(
  selected: RecordingSettings["audioDevices"],
  settings: RecordingSettings | null,
): string {
  if (!settings) return "Loading"
  if (selected.length === 0) return "Off"
  if (selected.length === 1) return selected[0]?.label ?? "Off"
  return `${selected.length} selected`
}

function audioDeviceKey(
  device: RecordingSettings["audioDevices"][number],
): string {
  return `${device.kind}:${device.id}`
}

function selectedDisplay(
  settings: RecordingSettings | null,
  status: RecordingStatus | null,
  displays: RecordingDisplay[],
): RecordingDisplay | null {
  if (settings?.captureMode !== "display") return null

  return (
    displays.find((display) => display.id === settings.selectedDisplayId) ??
    displays.find((display) => display.id === status?.activeDisplay?.id) ??
    status?.activeDisplay ??
    null
  )
}

function captureTargetLabel(
  settings: RecordingSettings | null,
  status: RecordingStatus | null,
): string {
  if (!settings) return "Loading capture"
  if (settings.captureMode === "display") {
    return status?.activeDisplay?.name ?? "Desktop capture"
  }
  return status?.activeGame
    ? `${status.activeGame} is being captured`
    : "Alloy will start capturing when you launch a game."
}

function statusLabel(
  settings: RecordingSettings | null,
  status: RecordingStatus | null,
): string {
  if (!settings) return "Loading Capture"
  if (settings.captureMode === "display") return "Desktop Capture"
  if (!settings.enabled) return "Recording Off"
  return status?.activeGame ?? "Waiting for game"
}

function statusActive(status: RecordingStatus | null): boolean {
  return Boolean(status?.replayActive || status?.longRecordingActive)
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
