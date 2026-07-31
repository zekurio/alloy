import type {
  RecordingDisplay,
  RecordingSettings,
  RecordingStatus,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alloy/ui/components/tooltip"
import { cn } from "@alloy/ui/lib/utils"
import {
  ArrowRightIcon,
  ChevronDownIcon,
  Gamepad2Icon,
  MicIcon,
  MonitorIcon,
  Volume2Icon,
} from "lucide-react"
import { useMemo } from "react"
import type { CSSProperties, ReactNode } from "react"

import {
  mergeAudioDevices,
  type RecordingAudioDeviceView,
  toggleAudioDevice,
} from "@/lib/audio-device-selection"
import { alloyDesktop, type AlloyDesktop } from "@/lib/desktop"

import { DisplayPickerDialog } from "./recording-display-picker"
import {
  audioDeviceMultiSelectLabel,
  captureTargetLabel,
  type SaveRecordingSettings,
  selectedDisplay,
  statusActive,
  statusLabel,
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
        activeGame={
          state.settings?.enabled
            ? (state.status?.activeGameDetail ?? null)
            : null
        }
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

/**
 * Icon-only capture-status trigger for the sidebar rail. The status text lives
 * in a tooltip (and the aria-label); the popover opens to the right of the
 * rail.
 */
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
  const icon =
    activeGame && settings?.captureMode !== "display" ? (
      <GameIcon
        src={activeGame.iconUrl}
        name={activeGame.name}
        className="size-5"
      />
    ) : settings?.captureMode === "display" ? (
      <MonitorIcon className="size-5" />
    ) : (
      <Gamepad2Icon className="size-5 shrink-0 text-current" />
    )
  const statusText = t("Capture status: {label}", { label })
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={statusText}
                  className={cn(
                    "flex size-11 shrink-0 appearance-none items-center justify-center rounded-md border-0 bg-transparent outline-none",
                    "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                    "hover:bg-surface-raised data-popup-open:bg-surface-raised",
                    "focus-visible:ring-ring focus-visible:ring-2",
                    active
                      ? "text-foreground"
                      : "text-foreground-muted hover:text-foreground",
                  )}
                >
                  {icon}
                </button>
              }
            />
          }
        />
        <TooltipContent side="right">{statusText}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        side="right"
        // 8px matches the rail's own inset, so the gap to the rail reads the
        // same as the gap the aligned popover leaves at the window bottom.
        sideOffset={8}
        className="alloy-blur w-[26rem] max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden border p-0 ring-0"
        style={
          {
            "--alloy-blur-opacity": "90%",
            "--alloy-blur-blur": "36px",
            "--alloy-blur-shadow": "0 30px 80px -32px rgb(0 0 0 / 0.78)",
          } as CSSProperties
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
        <div className="text-sm font-semibold">{t("Capture with Alloy")}</div>
        {settings ? (
          <div className="flex items-center gap-2">
            <span className="text-foreground-dim text-[10px] font-semibold tracking-wide uppercase">
              {settings.enabled ? t("On") : t("Off")}
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
          <span>{t("Capture settings")}</span>
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
  const audioDevices = useMemo(
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
          {t("Audio settings")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-accent h-7 px-1.5"
          onClick={() => void desktop.openSettings()}
        >
          {t("Manage Audio")}
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </div>
      {settings?.audioMode !== "applications" ? (
        <AudioRow
          icon={<Volume2Icon className="size-4" />}
          label={t("Audio source")}
          kind="output"
          devices={audioDevices}
          settings={settings}
          onSave={onSave}
        />
      ) : null}
      <AudioRow
        icon={<MicIcon className="size-4" />}
        label={t("Microphone source")}
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
          } as CSSProperties
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
          className="w-full"
          onClick={() =>
            void onSave({
              ...settings,
              captureMode: "game",
              selectedDisplayId: "",
            })
          }
        >
          <Gamepad2Icon className="size-4" />
          {t("Use Game Capture")}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={onOpenDisplayPicker}
        >
          <MonitorIcon className="size-4" />
          {t("Use Display Capture")}
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
  icon: ReactNode
  label: string
  kind: "output" | "input"
  devices: RecordingAudioDeviceView[]
  settings: RecordingSettings | null
  onSave: SaveRecordingSettings
}) {
  const options = devices.filter((device) => device.kind === kind)
  const selected = options.filter((device) => device.enabled)
  const hasUnavailableSelection = selected.some((device) => !device.available)
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
              disabled={disabled}
              className="w-full min-w-0 justify-between gap-2 px-3"
            >
              <span className="truncate">
                {audioDeviceMultiSelectLabel(selected, settings)}
                {hasUnavailableSelection ? ` · ${t("Unavailable")}` : ""}
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
              disabled={!device.available && !device.enabled}
              onCheckedChange={(checked) => {
                if (!settings) return
                void onSave({
                  ...settings,
                  audioDevices: toggleAudioDevice(settings.audioDevices, {
                    id: device.id,
                    label: device.label,
                    kind: device.kind,
                    enabled: checked === true,
                    volume: device.volume,
                  }),
                })
              }}
            >
              <span className="truncate">
                {device.label}
                {!device.available ? ` (${t("Unavailable")})` : ""}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
