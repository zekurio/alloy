import assert from "node:assert/strict"
import { test } from "node:test"

import { encodeProgressPercent, encodeProgressTotalCost } from "./media-run"

test("encode progress weights rendition tiers by relative encode cost", () => {
  const totalCost = encodeProgressTotalCost([
    { height: 1080, fps: 60 },
    { height: 720, fps: 30 },
  ])

  assert.equal(totalCost, 86401.8)
  assert.equal(
    encodeProgressPercent({
      totalCost,
      completedCost: 1.4,
      phaseCost: 1080 * 60,
      fraction: 0.5,
    }),
    37,
  )
  assert.equal(
    encodeProgressPercent({
      totalCost,
      completedCost: 1.4 + 1080 * 60,
      phaseCost: 720 * 30,
      fraction: 1,
    }),
    99,
  )
})

test("encode progress keeps an empty ladder dominated by source download", () => {
  const totalCost = encodeProgressTotalCost([])

  assert.equal(totalCost, 1.8)
  assert.equal(
    encodeProgressPercent({
      totalCost,
      completedCost: 1,
      phaseCost: 0,
      fraction: 0,
    }),
    55,
  )
  assert.equal(
    encodeProgressPercent({
      totalCost,
      completedCost: 1.4,
      phaseCost: 0,
      fraction: 0,
    }),
    77,
  )
})
