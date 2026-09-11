import type { RecordingSettings } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { toast } from "@alloy/ui/lib/toast"

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
    <SettingsSubsection id="hotkeys" title={t("Hotkeys")}>
      <SettingRows>
        <SettingRow
          title={t("Screenshot")}
          description={t("Saves the current game or display as a PNG.")}
        >
          <HotkeyInput
            value={settings.hotkeys.screenshot}
            disabled={busy}
            ariaLabel={t("Screenshot shortcut")}
            onChange={(screenshot) => {
              if (screenshot && screenshot === settings.hotkeys.clip) {
                toast.error(t("This shortcut is already assigned to clips."))
                return
              }
              void save({
                ...settings,
                hotkeys: { ...settings.hotkeys, screenshot },
              })
            }}
          />
        </SettingRow>
        <SettingRow
          title={t("Clip")}
          description={t("Saves the configured replay buffer.")}
        >
          <HotkeyInput
            value={settings.hotkeys.clip}
            disabled={busy}
            ariaLabel={t("Clip shortcut")}
            onChange={(clip) => {
              if (clip && clip === settings.hotkeys.screenshot) {
                toast.error(
                  t("This shortcut is already assigned to screenshots."),
                )
                return
              }
              void save({
                ...settings,
                hotkeys: { ...settings.hotkeys, clip },
              })
            }}
          />
        </SettingRow>
      </SettingRows>
    </SettingsSubsection>
  )
}
