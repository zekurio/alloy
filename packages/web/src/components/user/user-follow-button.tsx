import { t } from "@alloy/i18n"
import {
  FeedbackButton,
  type FeedbackButtonProps,
} from "@alloy/ui/components/feedback-button"
import { UserCheckIcon, UserMinusIcon, UserPlusIcon } from "lucide-react"

type UserFollowButtonProps = Omit<
  FeedbackButtonProps,
  "aria-label" | "aria-pressed" | "children" | "size" | "variant"
> & {
  following: boolean
  "aria-label"?: string
}

export function UserFollowButton({
  following,
  pendingLabel = t("Updating…"),
  errorLabel = t("Try again"),
  title,
  "aria-label": ariaLabel,
  ...props
}: UserFollowButtonProps) {
  return (
    <FeedbackButton
      type="button"
      variant={following ? "ghost" : "primary"}
      size="sm"
      aria-pressed={following}
      aria-label={ariaLabel ?? (following ? t("Unfollow") : t("Follow"))}
      title={title ?? (following ? t("Unfollow") : t("Follow"))}
      pendingLabel={pendingLabel}
      errorLabel={errorLabel}
      {...props}
    >
      {following ? (
        <>
          <UserCheckIcon className="group-hover/button:hidden group-focus-visible/button:hidden" />
          <UserMinusIcon className="hidden group-hover/button:block group-focus-visible/button:block" />
          <span className="group-hover/button:hidden group-focus-visible/button:hidden">
            {t("Following")}
          </span>
          <span className="hidden group-hover/button:inline group-focus-visible/button:inline">
            {t("Unfollow")}
          </span>
        </>
      ) : (
        <>
          <UserPlusIcon />
          {t("Follow")}
        </>
      )}
    </FeedbackButton>
  )
}
