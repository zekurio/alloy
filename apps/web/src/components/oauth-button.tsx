import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

interface OAuthButtonProps extends React.ComponentProps<"button"> {
  providerId: string
  /** Full label as entered by the admin in the OAuth configurator. */
  buttonText: string
}

/**
 * Text-only OAuth sign-in button. No per-provider branding — the admin-
 * written label carries the identity, and the login page avoids shipping
 * an icon atlas.
 */
export function OAuthButton({
  providerId,
  buttonText,
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
      <span className="truncate">{buttonText}</span>
    </Button>
  )
}
