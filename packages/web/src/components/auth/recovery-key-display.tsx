import type { NewRecoveryKey } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { FieldError } from "@alloy/ui/components/field"
import { CopyIcon, DownloadIcon } from "lucide-react"

import { startBrowserDownload } from "@/lib/browser-download"
import { copyTextToClipboard } from "@/lib/clipboard"
import { formatCalendarDate } from "@/lib/date-format"
import { useActionFeedback } from "@/lib/use-action-feedback"

/** The text file the key saves as: enough to find the way back later. */
function recoveryKeyFile(key: NewRecoveryKey, username: string): string {
  const origin = window.location.origin
  return [
    t("Alloy recovery key"),
    "",
    key.recoveryKey,
    "",
    `${t("Server")}: ${origin}`,
    `${t("Username")}: ${username}`,
    `${t("Created")}: ${formatCalendarDate(key.createdAt)}`,
    "",
    t(
      "If you lose every passkey, open {url} and enter your username and this key.",
      { url: new URL("/recover", origin).toString() },
    ),
    "",
  ].join("\n")
}

function saveRecoveryKeyFile(key: NewRecoveryKey, username: string): boolean {
  const url = URL.createObjectURL(
    new Blob([recoveryKeyFile(key, username)], { type: "text/plain" }),
  )
  const host = window.location.host.replace(/[^a-zA-Z0-9.-]+/g, "-")
  const started = startBrowserDownload(url, {
    filename: `alloy-recovery-key-${host}.txt`,
  })
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return started
}

/**
 * Shows a recovery key the one time it can be read, with ways to keep it.
 * The server stores only the key's hash.
 */
export function RecoveryKeyDisplay({
  recoveryKey,
  username,
}: {
  recoveryKey: NewRecoveryKey
  /** Written into the saved file next to the key. */
  username: string
}) {
  const copyFeedback = useActionFeedback()
  const saveFeedback = useActionFeedback()
  const copy = () =>
    copyFeedback.run(async () => {
      if (
        !(await copyTextToClipboard(recoveryKey.recoveryKey, {
          action: "copy recovery key",
        }))
      ) {
        throw new Error(t("Couldn't copy the recovery key"))
      }
    }, t("Couldn't copy the recovery key"))
  const save = () =>
    saveFeedback.run(() => {
      if (!saveRecoveryKeyFile(recoveryKey, username)) {
        throw new Error(t("Couldn't save the recovery key"))
      }
    }, t("Couldn't save the recovery key"))
  const error =
    copyFeedback.feedback.state === "error"
      ? copyFeedback.feedback.message
      : saveFeedback.feedback.state === "error"
        ? saveFeedback.feedback.message
        : null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-foreground-muted text-sm">
        {t(
          "This key gets you back in if you lose every passkey, and it won't be shown again.",
        )}
      </p>
      <code className="bg-surface-sunken text-foreground block rounded-md p-3 text-center font-mono text-base tracking-wide break-all select-all">
        {recoveryKey.recoveryKey}
      </code>
      <div className="flex flex-wrap gap-2">
        <FeedbackButton
          type="button"
          variant="secondary"
          className="flex-1"
          state={copyFeedback.feedback.state}
          pendingLabel={t("Copying…")}
          successLabel={t("Copied")}
          errorLabel={t("Try again")}
          onClick={() => void copy()}
        >
          <CopyIcon />
          {t("Copy")}
        </FeedbackButton>
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          onClick={() => void save()}
        >
          <DownloadIcon />
          {t("Save as file")}
        </Button>
      </div>
      <FieldError>{error}</FieldError>
    </div>
  )
}
