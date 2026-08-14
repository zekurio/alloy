import { t } from "@alloy/i18n"
import { NumberBadge } from "@alloy/ui/components/badge"
import { Button } from "@alloy/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@alloy/ui/components/popover"
import { cn } from "@alloy/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import {
  ArrowRightIcon,
  PlusIcon,
  TriangleAlertIcon,
  UploadCloudIcon,
} from "lucide-react"
import { useState, type CSSProperties } from "react"

import { GlobalUploadControl } from "./global-upload-control"
import { QueueItemRow } from "./queue-progress"
import { useUploadQueueSummary } from "./use-upload-queue-summary"

/**
 * The app-wide upload entry point and activity center, floating above the
 * mobile navigation or in the bottom-right corner on desktop. The trigger is
 * always available for starting another upload; its popover keeps transfer
 * and server-side processing progress together instead of creating a separate
 * error/status control in the app chrome.
 */
export function UploadCenter() {
  const [open, setOpen] = useState(false)
  const summary = useUploadQueueSummary()
  const activeCount = summary?.activeCount ?? 0
  const itemCount = summary?.items.length ?? 0
  const failedOnly =
    summary !== null && summary.activeCount === 0 && summary.failedCount > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={
              summary
                ? t("Upload center: {label}", { label: summary.label })
                : t("Upload center")
            }
            title={t("Upload center")}
            aria-hidden={open ? true : undefined}
            tabIndex={open ? -1 : undefined}
            style={{ transformOrigin: "bottom right" }}
            className={cn(
              "relative flex appearance-none items-center justify-center border outline-none",
              "transition-[background-color,color,box-shadow,transform,opacity] duration-[280ms] ease-[var(--ease-out)]",
              "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2",
              open
                ? "pointer-events-none scale-0 -rotate-12 opacity-0 duration-[160ms]"
                : "scale-100 rotate-0 opacity-100",
              "border-accent bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active size-12 rounded-full shadow-lg shadow-black/40 hover:shadow-xl",
            )}
          />
        }
      >
        {failedOnly ? (
          <TriangleAlertIcon className="text-accent-foreground size-[22px]" />
        ) : summary?.activeCount ? (
          <UploadCloudIcon className="size-[22px]" />
        ) : (
          <PlusIcon className="size-[22px]" />
        )}
        {activeCount > 0 ? (
          <NumberBadge aria-hidden className="absolute -top-1 -right-1">
            {activeCount > 99 ? "99+" : activeCount}
          </NumberBadge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={0}
        className={cn(
          "alloy-blur fixed right-3 top-auto bottom-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom)+0.75rem)] max-h-[calc(100dvh-var(--bottomnav-h)-env(safe-area-inset-bottom)-1.5rem)] w-[420px] max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden border p-0 ring-0 md:bottom-3 md:max-h-[calc(100dvh-1.5rem)]",
          "data-open:animate-[alloy-fab-morph-in_320ms_var(--ease-out)_forwards]",
          "data-closed:animate-[alloy-fab-morph-out_180ms_var(--ease-out)_forwards]",
        )}
        style={
          {
            transformOrigin: "bottom right",
            "--alloy-blur-opacity": "78%",
            "--alloy-blur-blur": "32px",
            "--alloy-blur-shadow":
              "0 30px 80px -32px var(--floating-shadow-strong-color)",
          } as CSSProperties
        }
      >
        <PopoverHeader>
          <PopoverTitle className="text-sm font-semibold">
            {t("Uploads")}
          </PopoverTitle>
          <div className="text-foreground-muted text-xs font-semibold tabular-nums">
            {itemCount === 0
              ? t("empty")
              : t("{count} {label}", {
                  count: itemCount,
                  label: itemCount === 1 ? t("item") : t("items"),
                })}
          </div>
        </PopoverHeader>
        <div className="max-h-[28rem] min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {summary ? (
            <div className="flex flex-col">
              {summary.items.map((item) => (
                <QueueItemRow key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="border-border flex flex-col items-center justify-center gap-1 rounded-md border border-dashed px-6 py-8 text-center">
              <p className="text-foreground text-sm font-medium">
                {t("Nothing in the queue")}
              </p>
              <p className="text-foreground-muted text-xs font-semibold">
                {t("New uploads and processing jobs appear here.")}
              </p>
            </div>
          )}
        </div>
        <div className="border-border grid shrink-0 grid-cols-2 items-center gap-2 border-t p-2">
          <Button
            nativeButton={false}
            variant="ghost"
            size="sm"
            className="text-foreground-muted w-full justify-between"
            render={
              <Link to="/library" onClick={() => setOpen(false)}>
                <span>{t("Open library")}</span>
                <ArrowRightIcon className="text-foreground-dim size-4" />
              </Link>
            }
          />
          <div className="[&>button]:w-full">
            <GlobalUploadControl variant="center" />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
