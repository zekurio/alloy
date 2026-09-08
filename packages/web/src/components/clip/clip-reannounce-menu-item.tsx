import { t } from "@alloy/i18n"
import { DropdownMenuItem } from "@alloy/ui/components/dropdown-menu"
import { MegaphoneIcon } from "lucide-react"

import { useReannounceClipMutation } from "@/lib/clip-queries"

export function ClipReannounceMenuItem({
  clipId,
  disabled,
}: {
  clipId: string
  disabled: boolean
}) {
  const mutation = useReannounceClipMutation()
  return (
    <DropdownMenuItem
      onClick={() => mutation.mutate({ clipId })}
      disabled={disabled || mutation.isPending}
    >
      <MegaphoneIcon />
      {mutation.isPending ? t("Queuing announcement…") : t("Reannounce")}
    </DropdownMenuItem>
  )
}
