import type { ProfileViewer } from "@alloy/api"
import { t } from "@alloy/i18n"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { ShieldOffIcon } from "lucide-react"
import { useState } from "react"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"

export function ProfileActions({
  targetHandle,
  viewer,
  onChange,
}: {
  targetHandle: string
  viewer: ProfileViewer | null | undefined
  onChange: (next: ProfileViewer) => void
}) {
  const [unblockPending, setUnblockPending] = useState(false)
  const [unblockError, setUnblockError] = useState<string | null>(null)
  if (!viewer || viewer.isSelf || !viewer.isBlocked) return null
  const activeViewer = viewer

  async function runUnblock() {
    if (unblockPending) return
    setUnblockError(null)
    setUnblockPending(true)
    const prev = activeViewer
    onChange({ ...prev, isBlocked: false })
    try {
      await api.users.unblock(targetHandle)
    } catch (cause) {
      onChange(prev)
      setUnblockError(errorMessage(cause, t("Something went wrong")))
    } finally {
      setUnblockPending(false)
    }
  }

  return (
    <FeedbackButton
      type="button"
      variant="ghost"
      size="sm"
      aria-label={t("Unblock")}
      title={unblockError ?? t("Unblock")}
      onClick={runUnblock}
      disabled={unblockPending}
      state={unblockPending ? "pending" : unblockError ? "error" : "idle"}
      pendingLabel={t("Unblocking…")}
      errorLabel={t("Try again")}
    >
      <ShieldOffIcon />
      {t("Unblock")}
    </FeedbackButton>
  )
}
