import { sliderValue } from "@alloy/ui/lib/utils"
import { useState } from "react"

/**
 * Tracks a slider locally while it is dragged and commits the value once on
 * release, so a drag saves the settings once instead of on every pointer move.
 * Spread `sliderProps` onto the slider and render `value` in any readout.
 */
export function useSliderDraft(
  value: number,
  onCommit: (value: number) => void,
) {
  const [draft, setDraft] = useState<number | null>(null)
  const current = draft ?? value

  return {
    value: current,
    sliderProps: {
      value: [current],
      onValueChange: (next: number | readonly number[]) =>
        setDraft(sliderValue(next)),
      onValueCommitted: (next: number | readonly number[]) => {
        setDraft(null)
        onCommit(sliderValue(next))
      },
    },
  }
}
