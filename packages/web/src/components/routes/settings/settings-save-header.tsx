import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { cn } from "@alloy/ui/lib/utils"
import { SaveIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import { useSettingsSaveState } from "./settings-save-context"

const LAYER_CLASS_NAME =
  "col-start-1 row-start-1 min-w-0 transition-[opacity,visibility] duration-[var(--duration-base)] ease-[var(--ease-out)] motion-reduce:transition-none"

/**
 * A settings section's title bar, which turns into the Cancel/Save banner
 * while any registered form has unsaved edits. Title and banner share one
 * grid cell and crossfade, so the panel below never moves. When a close or
 * tab switch gets blocked, the bar flashes and shakes.
 *
 * The banner only ever holds a short status. A failed save's own message can
 * be any length, so it opens in a strip under the header instead of being
 * cut off beside the buttons.
 */
export function SettingsSaveHeader({
  className,
  titleClassName,
  bannerClassName,
  compact = false,
  children,
}: {
  className?: string
  /** Layout of the title row passed as `children`. */
  titleClassName?: string
  bannerClassName?: string
  /** Phone layout: shorter copy, so it fits beside Cancel and Save. */
  compact?: boolean
  children: ReactNode
}) {
  const { dirty, saving, valid, attention, feedback, saveAll, discardAll } =
    useSettingsSaveState()
  const visible = dirty || feedback.state !== "idle"

  // Flash for a moment after each blocked attempt. Compare against the last
  // seen counter so a bump from an earlier dirty episode doesn't flash when
  // the header mounts.
  const [flashing, setFlashing] = useState(false)
  const lastAttention = useRef(attention)
  useEffect(() => {
    if (attention === lastAttention.current) return
    lastAttention.current = attention
    setFlashing(true)
    const timer = window.setTimeout(() => setFlashing(false), 450)
    return () => window.clearTimeout(timer)
  }, [attention])

  const live = {
    message:
      feedback.state === "error"
        ? compact
          ? t("Couldn't save")
          : t("Couldn't save changes")
        : feedback.state === "success"
          ? t("Changes saved.")
          : compact
            ? t("Unsaved changes")
            : t("You have unsaved changes."),
    saveState: saving ? ("pending" as const) : feedback.state,
  }
  // Hold the last banner while it fades out, so "Changes saved." doesn't
  // flip back to the dirty copy on its way out.
  const [held, setHeld] = useState(live)
  if (
    visible &&
    (held.message !== live.message || held.saveState !== live.saveState)
  ) {
    setHeld(live)
  }
  const banner = visible ? live : held

  // The failure's own message, unless it is only the generic fallback the
  // banner already says. Held like the banner, so it doesn't empty while
  // the strip closes.
  const detail =
    feedback.state === "error" &&
    feedback.message !== t("Couldn't save changes")
      ? feedback.message
      : null
  const [heldDetail, setHeldDetail] = useState(detail)
  if (detail !== null && detail !== heldDetail) setHeldDetail(detail)

  return (
    <>
      <header
        className={cn(
          "grid shrink-0 items-center border-b",
          "transition-[background-color,border-color,color] duration-[var(--duration-base)] ease-[var(--ease-out)] motion-reduce:transition-none",
          flashing
            ? "border-danger bg-danger text-white"
            : "border-border bg-background",
          className,
        )}
      >
        <div
          inert={visible}
          className={cn(
            LAYER_CLASS_NAME,
            titleClassName,
            visible && "invisible opacity-0",
          )}
        >
          {children}
        </div>
        <div
          inert={!visible}
          className={cn(
            LAYER_CLASS_NAME,
            bannerClassName,
            !visible && "invisible opacity-0",
          )}
        >
          {/* Keyed by attempt so repeated blocked closes replay the shake. */}
          <div
            key={attention}
            className={cn(
              "flex min-w-0 items-center gap-3",
              flashing && "animate-attention-shake",
            )}
          >
            <p
              role="status"
              className={cn(
                "line-clamp-2 min-w-0 flex-1 text-sm leading-snug font-medium",
                !flashing && "text-foreground",
              )}
            >
              {banner.message}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              className={cn(flashing && "text-white hover:text-white")}
              onClick={discardAll}
            >
              {t("Cancel")}
            </Button>
            <FeedbackButton
              type="button"
              variant="primary"
              size="sm"
              state={banner.saveState}
              pendingLabel={t("Saving…")}
              successLabel={t("Saved")}
              // The error icon already says it failed; a wide "Try again"
              // would leave a phone's status no room.
              errorLabel={compact ? t("Save") : t("Try again")}
              disabled={saving || !valid || banner.saveState === "success"}
              onClick={() => void saveAll()}
            >
              <SaveIcon />
              {t("Save")}
            </FeedbackButton>
          </div>
        </div>
      </header>
      {/* Opens by easing its row from 0fr to 1fr, so it slides down rather
          than snapping the panel below out of the way. */}
      <div
        inert={detail === null}
        className={cn(
          "grid shrink-0 transition-[grid-template-rows] duration-[var(--duration-base)] ease-[var(--ease-out)] motion-reduce:transition-none",
          detail === null ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <p
            role="alert"
            className={cn(
              "border-destructive/30 bg-danger-soft text-destructive border-b py-2.5 text-sm leading-snug",
              compact ? "px-4" : "px-10",
            )}
          >
            {heldDetail}
          </p>
        </div>
      </div>
    </>
  )
}
