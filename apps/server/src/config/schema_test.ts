import { test } from "node:test"

import { EncoderConfigPatchSchema, RuntimeConfigSchema } from "./schema"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

test("RuntimeConfigSchema defaults Intel low-power encoder options off", () => {
  const parsed = RuntimeConfigSchema.parse({
    runtimeConfigVersion: 1,
    encoder: {
      enabled: true,
      hwaccel: "qsv",
      qsvDevice: "/dev/dri/renderD128",
      vaapiDevice: "/dev/dri/renderD128",
    },
  })

  assert(
    parsed.encoder.intelLowPowerH264 === false,
    "H.264 low-power should default off",
  )
  assert(
    parsed.encoder.intelLowPowerHevc === false,
    "HEVC low-power should default off",
  )
})

test("EncoderConfigPatchSchema accepts Intel low-power encoder booleans", () => {
  const parsed = EncoderConfigPatchSchema.parse({
    intelLowPowerH264: true,
    intelLowPowerHevc: false,
  })

  assert(parsed.intelLowPowerH264 === true, "H.264 low-power should parse")
  assert(parsed.intelLowPowerHevc === false, "HEVC low-power should parse")
})

test("EncoderConfigPatchSchema rejects string Intel low-power values", () => {
  const parsed = EncoderConfigPatchSchema.safeParse({
    intelLowPowerH264: "true",
  })

  assert(!parsed.success, "string low-power value should not parse")
})
