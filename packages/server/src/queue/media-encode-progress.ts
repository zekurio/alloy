import type { LadderStep } from "@alloy/server/media/renditions"

const SOURCE_PHASE_COST = 1
const POSTER_PHASE_COST = 0.4
const FINALIZE_PHASE_COST = 0.4
// Must equal SOURCE + POSTER + FINALIZE phase costs; kept as an exact decimal
// literal because float summation (1 + 0.4 + 0.4) drifts off 1.8.
const BASE_PHASE_COST = 1.8
const AUDIO_STEM_ENCODE_COST_FRACTION = 0.05

type EncodeProgressStep = {
  height: number
  fps: number
}

export function encodeProgressTotalCost(
  steps: readonly EncodeProgressStep[],
  additionalPhaseCost = 0,
): number {
  return (
    BASE_PHASE_COST +
    additionalPhaseCost +
    steps.reduce((total, step) => total + encodeTierCost(step), 0)
  )
}

/** Reserve visible progress after the ladder while stems are being produced. */
export function audioStemPhaseCost(
  steps: readonly EncodeProgressStep[],
): number {
  return Math.max(
    1,
    steps.reduce((total, step) => total + encodeTierCost(step), 0) *
      AUDIO_STEM_ENCODE_COST_FRACTION,
  )
}

export function encodeProgressPercent(options: {
  totalCost: number
  completedCost: number
  phaseCost: number
  fraction: number
}): number {
  const fraction = Math.max(0, Math.min(1, options.fraction))
  return Math.min(
    99,
    Math.floor(
      ((options.completedCost + options.phaseCost * fraction) /
        options.totalCost) *
        100,
    ),
  )
}

export function encodeTierCost(step: EncodeProgressStep): number {
  return step.height * step.fps
}

export function makeEncodeProgressTracker(
  steps: readonly LadderStep[],
  writeProgress: (pct: number) => void,
  additionalPhaseCost = 0,
) {
  const totalCost = encodeProgressTotalCost(steps, additionalPhaseCost)
  let completedCost = 0
  const writeAt = (phaseCost: number, fraction: number) =>
    writeProgress(
      encodeProgressPercent({
        totalCost,
        completedCost,
        phaseCost,
        fraction,
      }),
    )
  return {
    writeAt,
    complete(phaseCost: number) {
      completedCost += phaseCost
      writeAt(0, 0)
    },
  }
}

export type EncodeProgressTracker = ReturnType<typeof makeEncodeProgressTracker>

export { FINALIZE_PHASE_COST, POSTER_PHASE_COST, SOURCE_PHASE_COST }
