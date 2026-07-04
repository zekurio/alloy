import type { TranscodingConfig } from "@alloy/contracts"
import { createLogger } from "@alloy/logging"
import { configStore } from "@alloy/server/config/store"

import { enqueueRenditionsSweep } from "./kinds/renditions-sweep"

const logger = createLogger("jobs")

let unsubscribeConfig: (() => void) | null = null

export function startJobTriggers(): void {
  if (unsubscribeConfig) return
  unsubscribeConfig = configStore.subscribe((next, prev) => {
    if (outputAffectingEqual(next.transcoding, prev.transcoding)) return
    void enqueueRenditionsSweep("stale", {
      runAt: new Date(Date.now() + 60_000),
    }).catch((err: unknown) => {
      logger.error(
        "failed to enqueue rendition sweep after config change:",
        err,
      )
    })
  })
}

export function stopJobTriggers(): void {
  unsubscribeConfig?.()
  unsubscribeConfig = null
}

function outputAffectingEqual(
  a: TranscodingConfig,
  b: TranscodingConfig,
): boolean {
  if (a.videoCodec !== b.videoCodec) return false
  if (a.quality !== b.quality) return false
  if (a.audioBitrateKbps !== b.audioBitrateKbps) return false
  if (a.tiers.length !== b.tiers.length) return false
  return a.tiers.every((tier, index) => {
    const other = b.tiers[index]
    if (!other) return false
    return (
      tier.height === other.height &&
      tier.maxFps === other.maxFps &&
      tier.maxrateKbps === other.maxrateKbps &&
      tier.codec === other.codec &&
      tier.og === other.og
    )
  })
}
