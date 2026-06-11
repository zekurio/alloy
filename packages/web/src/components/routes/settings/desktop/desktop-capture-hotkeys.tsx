import type { RecordingClipHotkey, RecordingSettings } from "@alloy/contracts"
import { Button } from "@alloy/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { PlusIcon, Trash2Icon } from "lucide-react"

import { Subsection } from "./desktop-capture-sections"
import { formatDuration } from "./desktop-recording-helpers"
import { HotkeyInput } from "./hotkey-input"

const CLIP_DURATION_OPTIONS = [15, 30, 60, 90, 120, 180, 300, 600] as const

export function HotkeysSection({
  settings,
  busy,
  save,
}: {
  settings: RecordingSettings
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
}) {
  return (
    <Subsection title="Hotkeys">
      <div className="flex flex-col gap-2 pb-3">
        {settings.hotkeys.clips.map((clip, index) => (
          <ClipHotkeyRow
            key={clip.id}
            clip={clip}
            index={index}
            settings={settings}
            busy={busy}
            save={save}
          />
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() =>
            void save({
              ...settings,
              hotkeys: {
                ...settings.hotkeys,
                clips: [
                  ...settings.hotkeys.clips,
                  {
                    id: newHotkeyId(),
                    hotkey: "",
                    durationSeconds: 30,
                  },
                ],
              },
            })
          }
          className="self-start"
        >
          <PlusIcon className="size-3.5" />
          Add clip hotkey
        </Button>
      </div>

      <SettingRow
        title="Bookmark"
        description="Adds a numbered chapter to an active long recording."
      >
        <HotkeyInput
          value={settings.hotkeys.bookmark}
          disabled={busy}
          ariaLabel="Bookmark shortcut"
          onChange={(bookmark) =>
            void save({
              ...settings,
              hotkeys: { ...settings.hotkeys, bookmark },
            })
          }
        />
      </SettingRow>
      <SettingRow
        title="Screenshot"
        description="Captures the active recording source."
      >
        <HotkeyInput
          value={settings.hotkeys.screenshot}
          disabled={busy}
          ariaLabel="Screenshot shortcut"
          onChange={(screenshot) =>
            void save({
              ...settings,
              hotkeys: { ...settings.hotkeys, screenshot },
            })
          }
        />
      </SettingRow>
      <SettingRow
        title="Long recording"
        description="Starts or stops a manual long recording."
      >
        <HotkeyInput
          value={settings.hotkeys.toggleLongRecording}
          disabled={busy}
          ariaLabel="Long recording shortcut"
          onChange={(toggleLongRecording) =>
            void save({
              ...settings,
              hotkeys: { ...settings.hotkeys, toggleLongRecording },
            })
          }
        />
      </SettingRow>
    </Subsection>
  )
}

function ClipHotkeyRow({
  clip,
  index,
  settings,
  busy,
  save,
}: {
  clip: RecordingClipHotkey
  index: number
  settings: RecordingSettings
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
}) {
  const updateClip = (next: RecordingClipHotkey) =>
    void save({
      ...settings,
      hotkeys: {
        ...settings.hotkeys,
        clips: settings.hotkeys.clips.map((candidate) =>
          candidate.id === clip.id ? next : candidate,
        ),
      },
    })
  const removeClip = () =>
    void save({
      ...settings,
      hotkeys: {
        ...settings.hotkeys,
        clips: settings.hotkeys.clips.filter(
          (candidate) => candidate.id !== clip.id,
        ),
      },
    })

  return (
    <div className="border-border bg-surface-raised/40 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
      <div className="min-w-28 flex-1">
        <div className="text-sm font-medium">Clip {index + 1}</div>
        <div className="text-foreground-dim text-xs">
          Saves {formatDuration(clip.durationSeconds)}
        </div>
      </div>
      <HotkeyInput
        value={clip.hotkey}
        disabled={busy}
        ariaLabel={`Clip ${index + 1} shortcut`}
        onChange={(hotkey) => updateClip({ ...clip, hotkey })}
      />
      <Select
        value={String(clip.durationSeconds)}
        disabled={busy}
        onValueChange={(value) =>
          updateClip({ ...clip, durationSeconds: Number(value) })
        }
      >
        <SelectTrigger size="sm" className="w-24">
          <SelectValue>{formatDuration(clip.durationSeconds)}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {CLIP_DURATION_OPTIONS.map((seconds) => (
            <SelectItem key={seconds} value={String(seconds)}>
              {formatDuration(seconds)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={busy}
        title="Remove clip hotkey"
        onClick={removeClip}
      >
        <Trash2Icon className="size-4" />
      </Button>
    </div>
  )
}

function newHotkeyId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `clip-${Date.now()}`
}
