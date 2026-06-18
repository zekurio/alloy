import { t as tx } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { cn } from "@alloy/ui/lib/utils"
import { SaveIcon } from "lucide-react"
import * as React from "react"

import { useSettingsSaveState } from "./settings-save-context"

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
  const [warned, setWarned] = React.useState(false)
  const lastAttention = React.useRef(attention)
  React.useEffect(() => {
    if (attention === lastAttention.current) return
    lastAttention.current = attention
    setWarned(true)
    const timer = window.setTimeout(() => setWarned(false), 1600)
    return () => window.clearTimeout(timer)
  }, [attention])

  if (!dirty) return null

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
          "flex items-center gap-3 px-4 py-3 sm:px-6",
          warned && "animate-attention-shake",
        )}
      >
        <p
          className={cn(
            "min-w-0 flex-1 text-sm",
            warned ? "text-destructive" : "text-foreground-dim",
          )}
        >
          {warned
            ? tx("You have unsaved settings — save or discard them first.")
            : tx("You have unsaved changes.")}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={discardAll}
        >
          {tx("Cancel")}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={saving}
          onClick={() => void saveAll()}
        >
          <SaveIcon />
          {saving ? tx("Saving…") : tx("Save")}
        </Button>
      </div>
    </div>
  )
}
