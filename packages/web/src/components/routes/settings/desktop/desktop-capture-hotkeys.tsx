import type {
  RecordingSettings,
  RecordingStatus,
} from "@alloy/desktop-contracts"
import { t } from "@alloy/i18n"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { toast } from "@alloy/ui/lib/toast"

import { SettingsSubsection } from "@/components/routes/settings/settings-panel"

import { recorderSupports } from "./desktop-recording-capabilities"
import { HotkeyInput } from "./hotkey-input"

export function HotkeysSection({
  settings,
  status,
  busy,
  save,
}: {
  settings: RecordingSettings
  status: RecordingStatus
  busy: boolean
  save: (next: RecordingSettings) => Promise<void>
}) {
  // Where the recorder has no key hook (Linux), the desktop environment binds
  // the shortcuts through the GlobalShortcuts portal and the user changes
  // them in its own settings; the saved hotkeys are only a first suggestion.
  if (!recorderSupports(status, "hotkeys")) {
    return (
      <SettingsSubsection id="hotkeys" title={t("Hotkeys")}>
        <p className="text-foreground-dim text-xs">
          {t(
            "Your desktop owns the clip and screenshot shortcuts. Change them in its keyboard settings. If it has no shortcut portal, bind {clip} and {screenshot} there instead.",
            {
              clip: "alloy-desktop --action clip",
              screenshot: "alloy-desktop --action screenshot",
            },
          )}
        </p>
      </SettingsSubsection>
    )
  }

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
