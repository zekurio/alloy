import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { cn } from "@alloy/ui/lib/utils"
import { UserKeyIcon } from "lucide-react"
import type { ComponentProps } from "react"

interface OAuthButtonProps extends ComponentProps<"button"> {
  providerId: string
  /** Human-readable provider name, rendered as "Continue with {displayName}". */
  displayName: string
  pendingLabel?: string
}

export function OAuthButton({
  providerId,
  displayName,
  pendingLabel,
  className,
  ...props
}: OAuthButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className={cn("gap-3", className)}
      data-provider={providerId}
      {...props}
    >
      <UserKeyIcon className="size-4" />
      <span className="truncate">
        {pendingLabel ?? t("Continue with {displayName}", { displayName })}
      </span>
    </Button>
  )
}
