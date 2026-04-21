import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

interface OAuthButtonProps extends React.ComponentProps<"button"> {
  providerId: string
  /** Human-readable provider name, rendered as "Continue with {displayName}". */
  displayName: string
}

export function OAuthButton({
  providerId,
  displayName,
  className,
  ...props
}: OAuthButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className={cn(className)}
      data-provider={providerId}
      {...props}
    >
      <span className="truncate">Continue with {displayName}</span>
    </Button>
  )
}
