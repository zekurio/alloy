import type { ProfileViewer } from "@alloy/api"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { useNavigate } from "@tanstack/react-router"
import { ShieldOffIcon } from "lucide-react"
import { useState } from "react"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { useToggleUserFollowMutation } from "@/lib/user-queries"

export function ProfileActions({
  targetHandle,
  viewer,
  onChange,
}: {
  targetHandle: string
  viewer: ProfileViewer | null | undefined
  onChange: (next: ProfileViewer) => void
}) {
  const navigate = useNavigate()
  const followMutation = useToggleUserFollowMutation(targetHandle)
  const [unblockPending, setUnblockPending] = useState(false)
  const [unblockError, setUnblockError] = useState<string | null>(null)
  const pending = unblockPending || followMutation.isPending

  if (viewer === undefined) {
    return (
      <Button
        type="button"
        variant="primary"
        size="sm"
        aria-label={t("Follow")}
        disabled
      >
        {t("Follow")}
      </Button>
    )
  }

  if (!viewer) {
    return (
      <Button
        type="button"
        variant="primary"
        size="sm"
        aria-label={t("Sign in to follow")}
        title={t("Sign in to follow")}
        onClick={() => {
          void navigate({ to: "/login" })
        }}
      >
        {t("Follow")}
      </Button>
    )
  }

  // Self-profile: no follow controls.
  if (viewer.isSelf) return null

  const activeViewer = viewer
  const { isFollowing, isBlocked, isBlockedBy } = activeViewer

  function runFollow() {
    if (pending) return
    followMutation.mutate({ next: !isFollowing })
  }

  async function runUnblock() {
    if (pending) return
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

  if (isBlocked) {
    return (
      <FeedbackButton
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t("Unblock")}
        title={unblockError ?? t("Unblock")}
        onClick={runUnblock}
        disabled={pending}
        state={unblockPending ? "pending" : unblockError ? "error" : "idle"}
        pendingLabel={t("Unblocking…")}
        errorLabel={t("Try again")}
      >
        <ShieldOffIcon />
        {t("Unblock")}
      </FeedbackButton>
    )
  }

  if (isBlockedBy) {
    return null
  }

  return (
    <FeedbackButton
      type="button"
      variant={isFollowing ? "ghost" : "primary"}
      size="sm"
      aria-pressed={isFollowing}
      aria-label={isFollowing ? t("Unfollow") : t("Follow")}
      title={
        followMutation.error
          ? errorMessage(followMutation.error, t("Something went wrong"))
          : isFollowing
            ? t("Unfollow")
            : t("Follow")
      }
      onClick={runFollow}
      disabled={pending}
      state={
        followMutation.isPending
          ? "pending"
          : followMutation.isError
            ? "error"
            : "idle"
      }
      pendingLabel={t("Updating…")}
      errorLabel={t("Try again")}
    >
      {isFollowing ? t("Following") : t("Follow")}
    </FeedbackButton>
  )
}
