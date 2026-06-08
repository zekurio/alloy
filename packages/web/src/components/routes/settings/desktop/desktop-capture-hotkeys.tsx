import type { RecordingSettings } from "alloy-contracts"

import { Subsection } from "./desktop-capture-sections"
import { HotkeyInput } from "./hotkey-input"
import { SettingRow } from "./setting-row"

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
        title="Save replay clip"
        description="Saves the current replay window while a game is being captured."
      >
        <HotkeyInput
          value={settings.hotkeys.saveClip}
          disabled={busy}
          ariaLabel="Save replay clip shortcut"
          onChange={(saveClip) =>
            void save({
              ...settings,
              hotkeys: { ...settings.hotkeys, saveClip },
            })
          }
        />
      </SettingRow>
    </Subsection>
  )
}
