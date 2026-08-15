import type {
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundLibrary,
  RecordingNotificationSoundOption,
  RecordingNotificationSoundSettings,
  RecordingSettings,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { Slider } from "@alloy/ui/components/slider"
import { Switch } from "@alloy/ui/components/switch"
import { cn, sliderValue } from "@alloy/ui/lib/utils"
import { FolderOpenIcon, PlayIcon } from "lucide-react"
import { useState } from "react"

import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { useDesktopQuery } from "@/lib/use-desktop-query"

import { useDesktopRecording } from "./desktop-recording-context"

const SOUND_ROWS: Array<{
  id: RecordingNotificationSoundEvent
  title: string
  description: string
  defaultFile: string
}> = [
  {
    id: "replayBufferStarted",
    title: t("Replay buffer started"),
    description: t("Played when Alloy starts keeping replay clips ready."),
    defaultFile: "start_recording.wav",
  },
  {
    id: "clipSaved",
    title: t("Save clip"),
    description: t("Played when the replay hotkey starts saving a clip."),
    defaultFile: "clip_saved.wav",
  },
]

const EMPTY_LIBRARY: RecordingNotificationSoundLibrary = {
  replayBufferStarted: [],
  clipSaved: [],
}

export function NotificationSoundsSection({
  settings,
  busy,
  save,
}: {
  settings: RecordingSettings
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
}) {
  const {
    listNotificationSounds,
    openNotificationSoundsFolder,
    previewNotificationSound,
  } = useDesktopRecording()
  const { data, refetch } = useDesktopQuery(
    () => listNotificationSounds(),
    [listNotificationSounds],
  )
  const library = data ?? EMPTY_LIBRARY

  return (
    <SettingsSubsection id="sounds" title={t("Sounds")}>
      <SettingRows>
        {SOUND_ROWS.map((row) => (
          <SoundCard
            key={row.id}
            title={row.title}
            description={row.description}
            defaultFile={row.defaultFile}
            sound={settings.notificationSounds[row.id]}
            options={library[row.id]}
            busy={busy}
            onEnabledChange={(enabled) =>
              void saveSound(settings, save, row.id, { enabled })
            }
            onPathChange={(path) =>
              void saveSound(settings, save, row.id, { path })
            }
            onVolumeChange={(volume) =>
              void saveSound(settings, save, row.id, { volume })
            }
            onOpenFolder={() => void openNotificationSoundsFolder(row.id)}
            onPreview={() => void previewNotificationSound(row.id)}
            onRefresh={refetch}
          />
        ))}
      </SettingRows>
    </SettingsSubsection>
  )
}

function SoundCard({
  title,
  description,
  defaultFile,
  sound,
  options,
  busy,
  onEnabledChange,
  onPathChange,
  onVolumeChange,
  onOpenFolder,
  onPreview,
  onRefresh,
}: {
  title: string
  description: string
  defaultFile: string
  sound: RecordingNotificationSoundSettings
  options: RecordingNotificationSoundOption[]
  busy: boolean
  onEnabledChange: (enabled: boolean) => void
  onPathChange: (path: string) => void
  onVolumeChange: (volume: number) => void
  onOpenFolder: () => void
  onPreview: () => void
  onRefresh: () => void
}) {
  const [draftVolume, setDraftVolume] = useState<number | null>(null)
  const displayVolume = draftVolume ?? sound.volume

  // Empty path means "use the bundled default", which the shared folder is
  // seeded with — so resolve the selected value to that default file when
  // unset, and surface a custom path as its own entry.
  const items = soundItems(options, sound.path)
  const selectedValue =
    sound.path ||
    items.find((item) => fileName(item.name) === defaultFile)?.path ||
    ""
  const selectedItem = items.find((item) => item.path === selectedValue)
  const selectedLabel = selectedItem
    ? soundOptionLabel(selectedItem)
    : soundName(selectedValue)

  const controlsDisabled = busy || !sound.enabled

  return (
    <SettingRow
      title={title}
      description={description}
      align="start"
      footer={
        <>
          <div
            className={cn(
              "flex items-center justify-between gap-4 transition-opacity",
              controlsDisabled && "opacity-50",
            )}
          >
            <label
              htmlFor={`sound-effect-${title}`}
              className="text-foreground-dim text-xs font-medium"
            >
              {t("Sound effect")}
            </label>
            <div className="flex items-center gap-2">
              <Select
                value={selectedValue}
                disabled={controlsDisabled}
                onValueChange={(value) => {
                  if (value) onPathChange(value)
                }}
                onOpenChange={(open) => {
                  if (open) onRefresh()
                }}
              >
                <SelectTrigger
                  id={`sound-effect-${title}`}
                  size="sm"
                  className="w-48"
                >
                  <SelectValue placeholder={t("No sounds found")}>
                    {selectedLabel || t("No sounds found")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  {items.map((item) => (
                    <SelectItem key={item.path} value={item.path}>
                      {soundOptionLabel(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                disabled={busy || !selectedValue}
                title={t("Test sound")}
                aria-label={t("Test {title} sound", { title })}
                onClick={onPreview}
              >
                <PlayIcon className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={onOpenFolder}
              >
                <FolderOpenIcon className="size-3.5" />
                {t("Folder")}
              </Button>
            </div>
          </div>

          <div
            className={cn(
              "flex items-center justify-between gap-4 transition-opacity",
              controlsDisabled && "opacity-50",
            )}
          >
            <span className="text-foreground-dim text-xs font-medium">
              {t("Volume")}
            </span>
            <div className="flex w-48 items-center gap-3">
              <Slider
                min={0}
                max={100}
                step={1}
                value={[displayVolume]}
                disabled={controlsDisabled}
                onValueChange={(value) => setDraftVolume(sliderValue(value))}
                onValueCommitted={(value) => {
                  setDraftVolume(null)
                  onVolumeChange(sliderValue(value))
                }}
                className="min-w-0 flex-1"
              />
              <span className="text-foreground-muted w-9 shrink-0 text-right text-xs tabular-nums">
                {displayVolume}
                {"%"}
              </span>
            </div>
          </div>
        </>
      }
    >
      <Switch
        checked={sound.enabled}
        disabled={busy}
        onCheckedChange={onEnabledChange}
      />
    </SettingRow>
  )
}

/**
 * Shared folder files plus, if the saved sound points outside the folder, the
 * custom file so the dropdown can still show and keep it selected.
 */
function soundItems(
  options: RecordingNotificationSoundOption[],
  path: string,
): RecordingNotificationSoundOption[] {
  if (!path || options.some((option) => option.path === path)) return options
  return [...options, { path, name: fileName(path) }]
}

function saveSound(
  settings: RecordingSettings,
  save: (next: RecordingSettings) => Promise<void>,
  id: RecordingNotificationSoundEvent,
  patch: Partial<
    RecordingSettings["notificationSounds"][RecordingNotificationSoundEvent]
  >,
) {
  const sound = settings.notificationSounds[id]
  return save({
    ...settings,
    notificationSounds: {
      ...settings.notificationSounds,
      [id]: { ...sound, ...patch },
    },
  })
}

function soundName(path: string): string {
  return path ? fileName(path) : ""
}

function soundOptionLabel(option: RecordingNotificationSoundOption): string {
  return fileName(option.name || option.path)
}

function fileName(path: string): string {
  return path.replaceAll("\\", "/").split("/").pop() || path
}
