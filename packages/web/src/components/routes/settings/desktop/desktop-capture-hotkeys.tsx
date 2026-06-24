import type { RecordingSettings } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { SettingRow } from "@alloy/ui/components/setting-row"

import { SettingsSubsection } from "@/components/routes/settings/settings-panel"

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
    <SettingsSubsection title={t("Hotkeys")}>
      <SettingRow
        title={t("Clip")}
        description={t("Saves the configured replay buffer.")}
      >
        <HotkeyInput
          value={settings.hotkeys.clip}
          disabled={busy}
          ariaLabel={t("Clip shortcut")}
          onChange={(clip) =>
            void save({
              ...settings,
              hotkeys: { ...settings.hotkeys, clip },
            })
          }
        />
      </SettingRow>
    </SettingsSubsection>
  )
}
