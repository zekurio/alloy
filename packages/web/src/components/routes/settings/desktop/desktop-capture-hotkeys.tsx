import type { RecordingSettings } from "@alloy/contracts"
import { SettingRow } from "@alloy/ui/components/setting-row"

import { Subsection } from "./desktop-capture-sections"
import { HotkeyInput } from "./hotkey-input"

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
      <SettingRow
        title="Clip"
        description="Saves the configured replay buffer."
      >
        <HotkeyInput
          value={settings.hotkeys.clip}
          disabled={busy}
          ariaLabel="Clip shortcut"
          onChange={(clip) =>
            void save({
              ...settings,
              hotkeys: { ...settings.hotkeys, clip },
            })
          }
        />
      </SettingRow>
      <SettingRow
        title="Bookmark"
        description="Adds a marker to an active recording."
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
    </Subsection>
  )
}
