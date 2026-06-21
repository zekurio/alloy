import { t } from "@alloy/i18n"
import { cn } from "@alloy/ui/lib/utils"
import { Loader2Icon } from "lucide-react"
import type { ComponentProps } from "react"

function Spinner({ className, ...props }: ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label={t("Loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
