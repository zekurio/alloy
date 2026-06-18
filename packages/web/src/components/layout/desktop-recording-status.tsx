import type {
  RecordingDisplay,
  RecordingSettings,
  RecordingStatus,
} from "@alloy/contracts"
import { t as tx } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { GameIcon } from "@alloy/ui/components/game-icon"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { Switch } from "@alloy/ui/components/switch"
import { cn } from "@alloy/ui/lib/utils"
import {
  ArrowRightIcon,
  ChevronDownIcon,
  Gamepad2Icon,
  MicIcon,
  MonitorIcon,
  Volume2Icon,
} from "lucide-react"
import * as React from "react"

import { alloyDesktop, type AlloyDesktop } from "@/lib/desktop"

import { DisplayPickerDialog } from "./recording-display-picker"
import {
  audioDeviceMultiSelectLabel,
  captureTargetLabel,
  mergeAudioDevices,
  type SaveRecordingSettings,
  selectedDisplay,
  statusActive,
  statusLabel,
  toggleAudioDevice,
} from "./recording-status-helpers"
import { useDesktopRecordingState } from "./use-desktop-recording-state"

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
            title={tx("Capture status")}
            aria-label={tx("Capture status: {label}", { label })}
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
        <div className="text-sm font-semibold">{tx("Capture with Alloy")}</div>
        {settings ? (
          <div className="flex items-center gap-2">
            <span className="text-foreground-dim text-[10px] font-semibold tracking-wide uppercase">
              {settings.enabled ? tx("On") : tx("Off")}
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
          <span>{tx("Capture settings")}</span>
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
          {tx("Audio settings")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-accent h-7 px-1.5"
          onClick={() => void desktop.openSettings()}
        >
          {tx("Manage Audio")}
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>
      <AudioRow
        icon={<Volume2Icon className="size-4" />}
        label={tx("Audio source")}
        kind="output"
        devices={audioDevices}
        settings={settings}
        onSave={onSave}
      />
      <AudioRow
        icon={<MicIcon className="size-4" />}
        label={tx("Microphone source")}
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
          className="h-9 w-full"
          onClick={() =>
            void onSave({
              ...settings,
              captureMode: "game",
              selectedDisplayId: "",
            })
          }
        >
          <Gamepad2Icon className="size-4" />
          {tx("Use Game Capture")}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full"
          onClick={onOpenDisplayPicker}
        >
          <MonitorIcon className="size-4" />
          {tx("Use Display Capture")}
        </Button>
      )}
    </>
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
    <div className="grid grid-cols-[1rem_minmax(0,1fr)_12rem] items-center gap-3">
      <span className="text-foreground-muted">{icon}</span>
      <span className="min-w-0 text-sm font-semibold">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              className="h-9 w-full min-w-0 justify-between gap-2 px-3"
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
