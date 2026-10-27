import type { ProfileViewer } from "@alloy/api"
import { t } from "@alloy/i18n"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { useMutation } from "@tanstack/react-query"
import { ShieldOffIcon } from "lucide-react"

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
  // Optimistic: the button hides at once and comes back if the call fails.
  const unblock = useMutation({
    mutationFn: (_previous: ProfileViewer) => api.users.unblock(targetHandle),
    onMutate: (previous) => onChange({ ...previous, isBlocked: false }),
    onError: (_cause, previous) => onChange(previous),
  })
  if (!viewer || viewer.isSelf || !viewer.isBlocked) return null
  const unblockPending = unblock.isPending
  const unblockError = unblock.error
    ? errorMessage(unblock.error, t("Something went wrong"))
    : null

  return (
    <FeedbackButton
      type="button"
      variant="ghost"
      size="sm"
      aria-label={t("Unblock")}
      title={unblockError ?? t("Unblock")}
      onClick={() => {
        if (!unblockPending) unblock.mutate(viewer)
      }}
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
