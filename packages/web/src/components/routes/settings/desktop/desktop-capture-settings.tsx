import { t } from "@alloy/i18n"
import { ConfirmActionDialog } from "@alloy/ui/components/confirm-action-dialog"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { RefreshCcwIcon } from "lucide-react"
import { useState } from "react"

import {
  SettingsSections,
  SettingsSubsection,
} from "@/components/routes/settings/settings-panel"
import { useActionFeedback } from "@/lib/use-action-feedback"

import { AllowedGamesSection } from "./desktop-capture-games"
import { HotkeysSection } from "./desktop-capture-hotkeys"
import { NotificationSoundsSection } from "./desktop-capture-notifications"
import { ModeSection } from "./desktop-capture-sections"
import {
  DesktopRecordingNotice,
  useDesktopRecording,
} from "./desktop-recording-context"
import { DesktopStorageSettings } from "./desktop-storage-settings"

function DesktopCaptureSettings() {
  const { settings, status, busy, save, restartBackend } = useDesktopRecording()
  const restartFeedback = useActionFeedback()
  const [restartDialogOpen, setRestartDialogOpen] = useState(false)

  if (!settings || !status) return null

  return (
    <>
      <DesktopRecordingNotice />
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
            onClick={() => setRestartDialogOpen(true)}
          >
            <RefreshCcwIcon className="size-3.5" />
            {t("Restart")}
          </FeedbackButton>
        </SettingRow>
      </ModeSection>

      <AllowedGamesSection settings={settings} busy={busy} save={save} />

      <HotkeysSection settings={settings} busy={busy} save={save} />

      <NotificationSoundsSection settings={settings} busy={busy} save={save} />
      <ConfirmActionDialog
        open={restartDialogOpen}
        onOpenChange={(open) => {
          setRestartDialogOpen(open)
          if (!open) restartFeedback.reset()
        }}
        title={t("Restart the Alloy agent?")}
        description={t(
          "Active recording and replay buffering will stop while the capture component restarts.",
        )}
        confirmLabel={t("Restart agent")}
        pendingLabel={t("Restarting...")}
        pending={restartFeedback.feedback.state === "pending"}
        error={
          restartFeedback.feedback.state === "error"
            ? restartFeedback.feedback.message
            : null
        }
        onConfirm={() => {
          void restartFeedback
            .run(restartBackend, t("Couldn't restart Alloy agent."))
            .then((completed) => {
              if (completed) setRestartDialogOpen(false)
            })
        }}
      />
    </>
  )
}

export function DesktopCapturePanel() {
  const { settings, status, storageInfo, error } = useDesktopRecording()
  if (!settings || !status || !storageInfo) {
    if (error) return <DesktopRecordingNotice />
    return <LoadingState variant="panel" />
  }

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
        <DesktopStorageSettings />
      </SettingsSubsection>
    </SettingsSections>
  )
}
