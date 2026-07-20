import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { cn } from "@alloy/ui/lib/utils"
import type { ComponentProps } from "react"

import { ProviderGlyph } from "@/components/auth/provider-glyph"

interface OAuthButtonProps extends ComponentProps<"button"> {
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
      <ProviderGlyph
        providerId={providerId}
        iconUrl={iconUrl}
        className="size-4"
      />
      <span className="truncate">
        {pendingLabel ?? t("Continue with {displayName}", { displayName })}
      </span>
    </Button>
  )
}
