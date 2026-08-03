import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { FeedbackButton } from "@alloy/ui/components/feedback-button"
import { cn } from "@alloy/ui/lib/utils"
import { SaveIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { errorMessage } from "@/lib/error-message"

import { useSettingsSaveState } from "./settings-save-context"

type SaveFeedback =
  | { state: "idle" | "pending" | "success" }
  | { state: "error"; message: string }

/**
 * Bottom-anchored Cancel/Save bar for the settings dialog. Slides in whenever
 * any registered form has unsaved edits; when a close or tab switch gets
 * blocked it shakes and rephrases itself as a warning.
 */
export function SettingsSaveBar() {
  const { dirty, saving, attention, saveAll, discardAll } =
    useSettingsSaveState()

  // Warn for a moment after each blocked attempt. Compare against the last
  // seen counter so a bump from an earlier dirty episode doesn't re-warn when
  // the bar reappears.
  const [warned, setWarned] = useState(false)
  const [feedback, setFeedback] = useState<SaveFeedback>({ state: "idle" })
  const lastAttention = useRef(attention)
  const resetTimer = useRef<number | null>(null)
  useEffect(() => {
    if (attention === lastAttention.current) return
    lastAttention.current = attention
    setWarned(true)
    const timer = window.setTimeout(() => setWarned(false), 1600)
    return () => window.clearTimeout(timer)
  }, [attention])

  useEffect(
    () => () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    },
    [],
  )

  async function handleSave() {
    if (saving || feedback.state === "pending") return
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    setFeedback({ state: "pending" })
    try {
      await saveAll()
      setFeedback({ state: "success" })
      resetTimer.current = window.setTimeout(() => {
        setFeedback({ state: "idle" })
        resetTimer.current = null
      }, 1400)
    } catch (cause) {
      setFeedback({
        state: "error",
        message: errorMessage(cause, t("Couldn't save changes")),
      })
    }
  }

  function handleDiscard() {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    resetTimer.current = null
    setFeedback({ state: "idle" })
    discardAll()
  }

  if (!dirty && feedback.state === "idle") return null

  return (
    <div
      className={cn(
        "border-border bg-background shrink-0 border-t",
        "animate-in fade-in-0 slide-in-from-bottom-2 duration-200",
        warned && "border-destructive/50",
      )}
    >
      {/* Keyed by attempt so repeated blocked closes replay the shake. */}
      <div
        key={attention}
        className={cn(
          "flex items-center gap-3 px-4 py-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pr-12 sm:pl-8",
          warned && "animate-attention-shake",
        )}
      >
        <p
          className={cn(
            "min-w-0 flex-1 text-sm",
            warned ? "text-destructive" : "text-foreground-dim",
          )}
        >
          {feedback.state === "error"
            ? feedback.message
            : feedback.state === "success"
              ? t("Changes saved.")
              : warned
                ? t("You have unsaved settings — save or discard them first.")
                : t("You have unsaved changes.")}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={handleDiscard}
        >
          {t("Cancel")}
        </Button>
        <FeedbackButton
          type="button"
          variant="primary"
          size="sm"
          state={saving ? "pending" : feedback.state}
          pendingLabel={t("Saving…")}
          successLabel={t("Saved")}
          errorLabel={t("Try again")}
          disabled={saving || feedback.state === "success"}
          onClick={() => void handleSave()}
        >
          <SaveIcon />
          {t("Save")}
        </FeedbackButton>
      </div>
    </div>
  )
}
