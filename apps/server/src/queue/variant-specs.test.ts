import type { EncoderVariant } from "@workspace/contracts"
import { buildVariantPlan } from "./variant-specs"

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    )
  }
}

function variant(id: string, height: number): EncoderVariant {
  return {
    id,
    name: `${height}p`,
    codec: "h264",
    height,
    quality: 23,
    audioBitrateKbps: 160,
    extraInputArgs: "",
    extraOutputArgs: "",
  }
}

Deno.test("buildVariantPlan skips variants above source height", () => {
  const plan = buildVariantPlan(
    "00000000-0000-0000-0000-000000000001",
    1080,
    [variant("1440p", 1440), variant("1080p", 1080), variant("720p", 720)],
    "1080p"
  )

  assertEquals(
    plan.specs.map((spec) => spec.id),
    ["1080p", "720p"]
  )
  assertEquals(plan.skipped, [
    { id: "1440p", label: "1440p", height: 1440, reason: "source is 1080p" },
  ])
})

Deno.test("buildVariantPlan orders variants by height descending", () => {
  const plan = buildVariantPlan(
    "00000000-0000-0000-0000-000000000001",
    1080,
    [variant("480p", 480), variant("1080p", 1080), variant("720p", 720)],
    "720p"
  )

  assertEquals(
    plan.specs.map((spec) => spec.id),
    ["1080p", "720p", "480p"]
  )
  assertEquals(
    plan.specs.map((spec) => spec.isDefault),
    [false, true, false]
  )
})

Deno.test("buildVariantPlan falls back to first eligible default", () => {
  const plan = buildVariantPlan(
    "00000000-0000-0000-0000-000000000001",
    720,
    [variant("1080p", 1080), variant("720p", 720), variant("480p", 480)],
    "1080p"
  )

  assertEquals(
    plan.specs.map((spec) => [spec.id, spec.isDefault]),
    [
      ["720p", true],
      ["480p", false],
    ]
  )
})

Deno.test("buildVariantPlan allows zero eligible variants", () => {
  const plan = buildVariantPlan(
    "00000000-0000-0000-0000-000000000001",
    360,
    [variant("1080p", 1080), variant("720p", 720)],
    "1080p"
  )

  assertEquals(plan.specs, [])
  assertEquals(
    plan.skipped.map((skipped) => skipped.id),
    ["1080p", "720p"]
  )
})
