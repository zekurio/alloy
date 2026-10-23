import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import {
  ResponsiveDialogClose,
  ResponsiveDialogFooter,
} from "@alloy/ui/components/responsive-dialog"
import type { ReactNode } from "react"

/** Cancel and submit for the admin form dialogs. */
export function AdminDialogFooter({
  pending,
  failed,
  disabled = false,
  pendingLabel,
  children,
}: {
  pending: boolean
  /** The last submit failed, so the button offers to try again. */
  failed: boolean
  /** Blocks submitting, e.g. while the form is unchanged or incomplete. */
  disabled?: boolean
  pendingLabel: string
  children: ReactNode
}) {
  return (
    <ResponsiveDialogFooter>
      <ResponsiveDialogClose
        render={<Button type="button" variant="ghost" disabled={pending} />}
      >
        {t("Cancel")}
      </ResponsiveDialogClose>
      <FeedbackButton
        type="submit"
        state={pending ? "pending" : failed ? "error" : "idle"}
        pendingLabel={pendingLabel}
        errorLabel={t("Try again")}
        disabled={pending || disabled}
      >
        {children}
      </FeedbackButton>
    </ResponsiveDialogFooter>
  )
}
