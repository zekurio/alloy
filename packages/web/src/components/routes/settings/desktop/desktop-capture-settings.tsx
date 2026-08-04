import { t } from "@alloy/i18n"
import { Callout } from "@alloy/ui/components/callout"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Spinner } from "@alloy/ui/components/spinner"
import { CircleAlertIcon, RefreshCcwIcon } from "lucide-react"

import {
  SettingsSections,
  SettingsSubsection,
} from "@/components/routes/settings/settings-panel"
import { useActionFeedback } from "@/lib/use-action-feedback"

import { AllowedGamesSection } from "./desktop-capture-games"
import { HotkeysSection } from "./desktop-capture-hotkeys"
import { NotificationSoundsSection } from "./desktop-capture-notifications"
import { ModeSection } from "./desktop-capture-sections"
import { useDesktopRecording } from "./desktop-recording-context"
import { DesktopStorageSettings } from "./desktop-storage-settings"

export function DesktopCaptureSettings() {
  const { settings, status, busy, error, save, restartBackend } =
    useDesktopRecording()
  const restartFeedback = useActionFeedback()

  if (!settings || !status) {
    if (error) {
      return (
        <Callout tone="destructive">
          <CircleAlertIcon />
          <span>{error}</span>
        </Callout>
      )
    }
    return (
      <div className="text-foreground-muted flex h-20 items-center justify-center gap-2 text-sm">
        <Spinner />
        {t("Loading capture settings")}
      </div>
    )
  }

  return (
    <>
      {error ? (
        <Callout tone="destructive">
          <CircleAlertIcon />
          <span>{error}</span>
        </Callout>
      ) : status.message ? (
        <Callout
          tone={status.backend === "missing" ? "warning" : "destructive"}
        >
          <CircleAlertIcon />
          <span>{t(status.message)}</span>
        </Callout>
      ) : null}
      <ModeSection settings={settings} status={status} busy={busy} save={save}>
        <SettingRow
          title={t("Alloy agent")}
          description={t(
            "Restart the capture component if recording gets stuck.",
          )}
        >
          <FeedbackButton
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            state={restartFeedback.feedback.state}
            pendingLabel={t("Restarting...")}
            successLabel={t("Restarted")}
            errorLabel={t("Try again")}
            onClick={() => {
              void restartFeedback.run(
                restartBackend,
                t("Couldn't restart Alloy agent."),
              )
            }}
          >
            <RefreshCcwIcon className="size-3.5" />
            {t("Restart")}
          </FeedbackButton>
        </SettingRow>
      </ModeSection>

      <AllowedGamesSection settings={settings} busy={busy} save={save} />

      <HotkeysSection settings={settings} busy={busy} save={save} />

      <NotificationSoundsSection settings={settings} busy={busy} save={save} />
    </>
  )
}

export function DesktopCapturePanel() {
  return (
    <SettingsSections>
      <DesktopCaptureSettings />
      <SettingsSubsection
        id="storage"
        title={t("Storage")}
        description={t(
          "Choose where clips are saved and review local disk usage.",
        )}
      >
        <DesktopStoragePanel />
      </SettingsSubsection>
    </SettingsSections>
  )
}

export function DesktopStoragePanel() {
  const { settings, storageInfo, error } = useDesktopRecording()

  if (!settings || !storageInfo) {
    if (error) {
      return (
        <Callout tone="destructive">
          <CircleAlertIcon />
          <span>{error}</span>
        </Callout>
      )
    }
    return (
      <div className="text-foreground-muted flex h-20 items-center justify-center gap-2 text-sm">
        <Spinner />
        {t("Loading storage settings")}
      </div>
    )
  }

  return <DesktopStorageSettings />
}
