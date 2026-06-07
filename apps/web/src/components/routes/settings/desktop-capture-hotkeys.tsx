import type { RecordingSettings } from "alloy-contracts"

import { HotkeyInput } from "@/components/routes/settings/hotkey-input"
import { SettingRow } from "@/components/routes/settings/setting-row"

import { Subsection } from "./desktop-capture-sections"

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
