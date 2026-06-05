import type * as React from "react"

import {
  type AdminEncoderConfig,
  type AdminRuntimeConfig,
  ENCODER_HWACCELS,
  type EncoderHwaccel,
} from "@workspace/api"

import { toast } from "@workspace/ui/lib/toast"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { isAllowedString, trimString } from "./shared"

export const HWACCEL_LABELS: Record<EncoderHwaccel, string> = {
  none: "None",
  amf: "AMD AMF",
  nvenc: "Nvidia NVENC",
  qsv: "Intel Quicksync (QSV)",
  rkmpp: "Rockchip MPP (RKMPP)",
  vaapi: "Video Acceleration API (VAAPI)",
  videotoolbox: "Apple VideoToolBox",
  v4l2m2m: "Video4Linux2 (V4L2)",
}

export function isEncoderHwaccel(
  value: string | number | null,
): value is EncoderHwaccel {
  return isAllowedString(value, ENCODER_HWACCELS)
}

function normalizeEncoderConfig(
  config: AdminEncoderConfig,
): AdminEncoderConfig {
  return {
    ...config,
    qsvDevice: trimString(config.qsvDevice),
    vaapiDevice: trimString(config.vaapiDevice),
  }
}

export function encoderConfigsEqual(
  left: AdminEncoderConfig,
  right: AdminEncoderConfig,
): boolean {
  return (
    JSON.stringify(normalizeEncoderConfig(left)) ===
      JSON.stringify(normalizeEncoderConfig(right))
  )
}

export async function saveEncoderConfig({
  form,
  onChange,
  setPending,
  onSaved,
}: {
  form: AdminEncoderConfig
  onChange: (next: AdminRuntimeConfig) => void
  setPending: React.Dispatch<React.SetStateAction<boolean>>
  onSaved?: () => void
}) {
  setPending(true)
  try {
    const next = await api.admin.updateEncoderConfig(
      normalizeEncoderConfig(form),
    )
    onChange(next)
    toast.success("Encoder updated")
    onSaved?.()
  } catch (cause) {
    toast.error(errorMessage(cause, "Couldn't update encoder"))
  } finally {
    setPending(false)
  }
}
