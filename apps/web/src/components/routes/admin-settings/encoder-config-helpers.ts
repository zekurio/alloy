import type * as React from "react"

import {
  type AdminEncoderCapabilities,
  type AdminEncoderConfig,
  type AdminEncoderVariant,
  type AdminRuntimeConfig,
  ENCODER_HWACCELS,
  type EncoderHwaccel,
} from "@workspace/api"

import { toast } from "@workspace/ui/lib/toast"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { isAllowedString, requiredTrimmedString, trimString } from "./shared"

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

export function variantCodecAvailable(
  caps: AdminEncoderCapabilities | null,
  hwaccel: EncoderHwaccel,
  variant: AdminEncoderVariant,
): boolean {
  return caps?.ffmpegOk
    ? (caps.available[hwaccel]?.[variant.codec] ?? false)
    : true
}

/**
 * Build a copy name for a duplicated variant, appending "copy" (and a counter
 * when needed) so the ladder never holds two identically named variants.
 * `usedNames` must contain the lowercased, trimmed names already in use.
 */
export function uniqueVariantName(
  name: string,
  usedNames: Set<string>,
): string {
  const base = name.trim() || "Variant"
  let candidate = `${base} copy`
  let suffix = 2
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base} copy ${suffix}`
    suffix += 1
  }
  return candidate
}

export function variantIdFromName(name: string, usedIds: Set<string>): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "variant"
  let id = base
  let suffix = 2
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  return id
}

export function normalizeEncoderVariant(
  variant: AdminEncoderVariant,
): AdminEncoderVariant {
  const preset = requiredTrimmedString(variant.preset)
  return {
    ...variant,
    name: trimString(variant.name),
    preset: preset ?? undefined,
  }
}

function normalizeEncoderConfig(
  config: AdminEncoderConfig,
): AdminEncoderConfig {
  return {
    ...config,
    qsvDevice: trimString(config.qsvDevice),
    vaapiDevice: trimString(config.vaapiDevice),
    variants: config.variants.map(normalizeEncoderVariant),
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
