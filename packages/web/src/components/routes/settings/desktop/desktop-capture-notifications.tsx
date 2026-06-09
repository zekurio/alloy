import type {
  RecordingNotificationSoundEvent,
  RecordingNotificationSoundSettings,
  RecordingSettings,
} from "alloy-contracts"
import { Button } from "alloy-ui/components/button"
import { Slider } from "alloy-ui/components/slider"
import { Switch } from "alloy-ui/components/switch"
import { FolderOpenIcon, RotateCcwIcon } from "lucide-react"
import { useState, type ReactNode } from "react"

import { Subsection } from "./desktop-capture-sections"
import { useDesktopRecording } from "./desktop-recording-context"
import { SettingRow } from "./setting-row"

const SOUND_ROWS: Array<{
  id: RecordingNotificationSoundEvent
  title: string
  description: string
  defaultFile: string
}> = [
  {
    id: "recordingStarted",
    title: "Recording started",
    description: "Played when Alloy starts recording a detected game.",
    defaultFile: "start_recording.wav",
  },
  {
    id: "clipSaved",
    title: "Save clip",
    description: "Played when the replay hotkey starts saving a clip.",
    defaultFile: "bookmark.wav",
  },
]

export function NotificationSoundsSection({
  settings,
  busy,
  save,
}: {
  settings: RecordingSettings
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
}) {
  const { chooseNotificationSound } = useDesktopRecording()

  return (
    <Subsection title="Sounds">
      <div className="flex flex-col">
        {SOUND_ROWS.map((row) => {
          const sound = settings.notificationSounds[row.id]
          const description = (
            <SoundDescription
              description={row.description}
              defaultFile={row.defaultFile}
              path={sound.path}
            />
          )

          return (
            <SettingRow
              key={row.id}
              title={row.title}
              description={description}
              className="items-start"
            >
              <SoundControls
                title={row.title}
                sound={sound}
                busy={busy}
                onEnabledChange={(enabled) =>
                  void saveSound(settings, save, row.id, { enabled })
                }
                onVolumeChange={(volume) =>
                  void saveSound(settings, save, row.id, { volume })
                }
                onChoose={() => void chooseNotificationSound(row.id)}
                onReset={() =>
                  void saveSound(settings, save, row.id, { path: "" })
                }
              />
            </SettingRow>
          )
        })}
      </div>
    </Subsection>
  )
}

function SoundControls({
  title,
  sound,
  busy,
  onEnabledChange,
  onVolumeChange,
  onChoose,
  onReset,
}: {
  title: string
  sound: RecordingNotificationSoundSettings
  busy: boolean
  onEnabledChange: (enabled: boolean) => void
  onVolumeChange: (volume: number) => void
  onChoose: () => void
  onReset: () => void
}) {
  const [draftVolume, setDraftVolume] = useState<number | null>(null)
  const displayVolume = draftVolume ?? sound.volume

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <Switch
          checked={sound.enabled}
          disabled={busy}
          onCheckedChange={onEnabledChange}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={onChoose}
        >
          <FolderOpenIcon className="size-3.5" />
          Change
        </Button>
        {sound.path ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={`Reset ${title} sound`}
            onClick={onReset}
          >
            <RotateCcwIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <div className="flex w-44 items-center gap-3 sm:w-56">
        <Slider
          min={0}
          max={100}
          step={1}
          value={[displayVolume]}
          disabled={busy || !sound.enabled}
          onValueChange={(value) => setDraftVolume(sliderValue(value))}
          onValueCommitted={(value) => {
            setDraftVolume(null)
            onVolumeChange(sliderValue(value))
          }}
          className="min-w-0 flex-1"
        />
        <span className="text-foreground-muted w-9 shrink-0 text-right text-xs tabular-nums">
          {displayVolume}%
        </span>
      </div>
    </div>
  )
}

function SoundDescription({
  description,
  defaultFile,
  path,
}: {
  description: string
  defaultFile: string
  path: string
}) {
  return (
    <>
      {description}
      <span className="mt-1 block max-w-[22rem] truncate">
        {path ? fileName(path) : `Default: ${defaultFile}`}
      </span>
    </>
  )
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

function fileName(path: string): ReactNode {
  return path.replaceAll("\\", "/").split("/").pop() || path
}

function sliderValue(value: number | readonly number[]): number {
  return typeof value === "number" ? value : (value[0] ?? 0)
}
