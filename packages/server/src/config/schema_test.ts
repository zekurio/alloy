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
  assert(
    parsed.encoder.tonemapping.enabled === true,
    "tone mapping should default on",
  )
  assert(
    parsed.encoder.tonemapping.algorithm === "bt2390",
    "BT.2390 should be the default tone mapping algorithm",
  )
  assert(
    parsed.encoder.tonemapping.peak === 100,
    "tone mapping peak should default to 100",
  )
  assert(
    parsed.encoder.tonemapping.vpp.enabled === true,
    "VPP tone mapping should default on",
  )
  assert(
    parsed.encoder.tonemapping.vpp.brightness === 16,
    "VPP tone mapping brightness should default to 16",
  )
  assert(
    parsed.encoder.tonemapping.vpp.contrast === 1,
    "VPP tone mapping contrast should default to 1",
  )
  assert(
    Object.keys(parsed.scheduledTasks).length === 0,
    "scheduled task overrides should default empty",
  )
})

test("RuntimeConfigSchema accepts scheduled task cron triggers", () => {
  const parsed = RuntimeConfigSchema.parse({
    runtimeConfigVersion: 1,
    scheduledTasks: {
      "clip-storage-cleanup": [
        { type: "startup", delayMs: 60_000 },
        { type: "cron", expression: "0 3 * * *" },
      ],
    },
  })

  assert(
    parsed.scheduledTasks["clip-storage-cleanup"]?.[1]?.type === "cron",
    "cron trigger should parse",
  )
  assert(
    parsed.scheduledTasks["clip-storage-cleanup"]?.[0]?.type === "startup",
    "startup trigger should parse",
  )
  assert(
    parsed.scheduledTasks["clip-storage-cleanup"]?.[0]?.delayMs === 60_000,
    "startup delay should parse",
  )
})

test("RuntimeConfigSchema rejects invalid scheduled task cron triggers", () => {
  const parsed = RuntimeConfigSchema.safeParse({
    runtimeConfigVersion: 1,
    scheduledTasks: {
      "clip-storage-cleanup": [{ type: "cron", expression: "0 0 0 0" }],
    },
  })

  assert(!parsed.success, "invalid cron should not parse")
})

test("EncoderConfigPatchSchema accepts Intel low-power encoder booleans", () => {
  const parsed = EncoderConfigPatchSchema.parse({
    intelLowPowerH264: true,
    intelLowPowerHevc: false,
    tonemapping: {
      algorithm: "mobius",
      param: 0.3,
      vpp: {
        brightness: 12,
      },
    },
  })

  assert(parsed.intelLowPowerH264 === true, "H.264 low-power should parse")
  assert(parsed.intelLowPowerHevc === false, "HEVC low-power should parse")
  assert(
    parsed.tonemapping?.algorithm === "mobius",
    "tone mapping algorithm should parse",
  )
  assert(parsed.tonemapping?.param === 0.3, "tone mapping param should parse")
  assert(
    parsed.tonemapping?.vpp?.brightness === 12,
    "VPP tone mapping brightness should parse",
  )
})

test("EncoderConfigPatchSchema rejects string Intel low-power values", () => {
  const parsed = EncoderConfigPatchSchema.safeParse({
    intelLowPowerH264: "true",
  })

  assert(!parsed.success, "string low-power value should not parse")
})
