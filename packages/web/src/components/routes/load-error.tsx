import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { AlertCircleIcon, CircleAlertIcon, RefreshCcwIcon } from "lucide-react"

import { EmptyState } from "@/components/feedback/empty-state"

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onRetry}>
      <RefreshCcwIcon />
      {t("Try again")}
    </Button>
  )
}

/** A page body whose first load failed. */
export function LoadErrorState({
  title,
  onRetry,
}: {
  title: string
  onRetry: () => void
}) {
  return (
    <EmptyState
      icon={AlertCircleIcon}
      size="lg"
      title={title}
      action={<RetryButton onRetry={onRetry} />}
    />
  )
}

/** A settings panel whose data failed to load. */
export function LoadErrorCallout({
  message,
  onRetry,
}: {
  message: string | null
  onRetry: () => void
}) {
  return (
    <Callout tone="destructive">
      <CircleAlertIcon />
      <div className="flex flex-1 items-center justify-between gap-3">
        <span>{message}</span>
        <RetryButton onRetry={onRetry} />
      </div>
    </Callout>
  )
}
