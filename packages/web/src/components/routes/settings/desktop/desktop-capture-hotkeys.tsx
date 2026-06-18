import type { RecordingSettings } from "@alloy/contracts"
import { t as tx } from "@alloy/i18n"
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
    <Subsection title={tx("Hotkeys")}>
      <SettingRow
        title={tx("Clip")}
        description={tx("Saves the configured replay buffer.")}
      >
        <HotkeyInput
          value={settings.hotkeys.clip}
          disabled={busy}
          ariaLabel={tx("Clip shortcut")}
          onChange={(clip) =>
            void save({
              ...settings,
              hotkeys: { ...settings.hotkeys, clip },
            })
          }
        />
      </SettingRow>
    </Subsection>
  )
}
