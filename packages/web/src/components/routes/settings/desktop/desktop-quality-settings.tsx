import { t } from "@alloy/i18n"
import { Spinner } from "@alloy/ui/components/spinner"

import {
  SettingsSections,
  SettingsSubsection,
} from "@/components/routes/settings/settings-panel"

import { EncodingSettingsGrid } from "./desktop-capture-encoding"
import { QualitySection, ReplayBufferSection } from "./desktop-capture-quality"
import {
  DesktopRecordingNotice,
  useDesktopRecording,
} from "./desktop-recording-context"

export function DesktopQualitySettings() {
  const { settings, status, busy, error, setSettings, save } =
    useDesktopRecording()

  if (!settings || !status) {
    if (error) return <DesktopRecordingNotice />
    return (
      <div className="text-foreground-muted flex h-20 items-center justify-center gap-2 text-sm">
        <Spinner />
        {t("Loading quality settings")}
      </div>
    )
  }

  return (
    <SettingsSections>
      <DesktopRecordingNotice />
      <SettingsSubsection id="quality-preset" title={t("Quality preset")}>
        <QualitySection settings={settings} busy={busy} save={save} />
      </SettingsSubsection>

      <SettingsSubsection id="video-encoding" title={t("Video encoding")}>
        <EncodingSettingsGrid
          settings={settings}
          status={status}
          busy={busy}
          save={save}
        />
      </SettingsSubsection>

      <ReplayBufferSection
        settings={settings}
        busy={busy}
        setSettings={setSettings}
        save={save}
      />
    </SettingsSections>
  )
}
