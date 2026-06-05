import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { UserKeyIcon } from "lucide-react"
import * as React from "react"

interface OAuthButtonProps extends React.ComponentProps<"button"> {
  providerId: string
  /** Human-readable provider name, rendered as "Continue with {displayName}". */
  displayName: string
  pendingLabel?: string
  buttonColor?: string
  buttonTextColor?: string
  iconUrl?: string
}

export function OAuthButton({
  providerId,
  displayName,
  pendingLabel,
  buttonColor,
  buttonTextColor,
  iconUrl,
  className,
  style,
  ...props
}: OAuthButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className={cn("gap-3", className)}
      data-provider={providerId}
      style={{
        ...style,
        backgroundColor: buttonColor ?? style?.backgroundColor,
        color: buttonTextColor ?? style?.color,
      }}
      {...props}
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className="size-4 object-contain" />
      ) : (
        <UserKeyIcon className="size-4" />
      )}
      <span className="truncate">
        {pendingLabel ?? `Continue with ${displayName}`}
      </span>
    </Button>
  )
}
