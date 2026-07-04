import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import { ArrowRightIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react"
import { useState } from "react"

import { QueueItemRow } from "./queue-progress"
import { useUploadQueueSummary } from "./use-upload-queue-summary"

/**
 * App-wide upload/processing status pill, mounted in the header so it follows
 * the user across every route. Renders nothing while the queue is idle; once
 * anything is uploading, processing, or failed it shows a compact trigger and
 * a popover listing each row with its cancel/retry/open actions.
 */
export function UploadStatusPill() {
  const [open, setOpen] = useState(false)
  const summary = useUploadQueueSummary()
  if (!summary) return null

  const failedOnly = summary.activeCount === 0 && summary.failedCount > 0
  const showPercent = summary.activeCount > 0 && !summary.indeterminate

  // The grid-item wrapper lives here (not in the header) so an idle pill —
  // which returns null above — leaves no stray grid cell behind.
  return (
    <div className="flex items-center justify-self-end">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              title={t("Upload status")}
              aria-label={t("Upload status: {label}", { label: summary.label })}
              className={cn(
                "inline-flex h-8 min-w-0 appearance-none items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-left outline-none",
                "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2",
                "hover:bg-surface-raised data-popup-open:bg-surface-raised transition-colors",
                failedOnly ? "text-destructive" : "text-foreground",
              )}
            >
              {failedOnly ? (
                <TriangleAlertIcon className="size-4 shrink-0" />
              ) : (
                <Loader2Icon className="size-4 shrink-0 animate-spin" />
              )}
              <span className="hidden min-w-0 truncate text-sm font-semibold md:inline">
                {summary.label}
              </span>
              {showPercent ? (
                <span className="text-foreground-muted hidden text-xs tabular-nums md:inline">
                  {summary.percent}%
                </span>
              ) : null}
            </button>
          }
        />
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[22rem] max-w-[calc(100vw-1.5rem)] gap-0 p-0"
        >
          <div className="border-border flex items-center justify-between gap-3 border-b px-3 py-2.5">
            <span className="text-sm font-semibold">{summary.label}</span>
            {summary.failedCount > 0 && summary.activeCount > 0 ? (
              <span className="text-destructive text-xs font-medium">
                {t("{count} failed", { count: summary.failedCount })}
              </span>
            ) : null}
          </div>
          <div className="flex max-h-[22rem] flex-col gap-1 overflow-y-auto p-2">
            {summary.items.map((item) => (
              <QueueItemRow key={item.id} item={item} />
            ))}
          </div>
          <div className="border-border flex h-11 items-center border-t px-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-between px-2 text-sm font-medium"
              render={
                <Link to="/library" onClick={() => setOpen(false)}>
                  <span>{t("Open library")}</span>
                  <ArrowRightIcon className="text-foreground-dim size-4" />
                </Link>
              }
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
