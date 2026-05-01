import type * as React from "react"

import {
  ENCODER_HWACCELS,
  type AdminEncoderCapabilities,
  type AdminEncoderConfig,
  type AdminEncoderVariant,
  type AdminRuntimeConfig,
  type EncoderHwaccel,
  type EncoderOpenGraphTarget,
} from "@workspace/api"

import { toast } from "@workspace/ui/lib/toast"

import { api } from "@/lib/api"

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
  value: string | number | null
): value is EncoderHwaccel {
  return (
    typeof value === "string" &&
    ENCODER_HWACCELS.includes(value as EncoderHwaccel)
  )
}

export function variantCodecAvailable(
  caps: AdminEncoderCapabilities | null,
  hwaccel: EncoderHwaccel,
  variant: AdminEncoderVariant
): boolean {
  return caps?.ffmpegOk
    ? (caps.available[hwaccel]?.[variant.codec] ?? false)
    : true
}

export function variantIdFromName(name: string, usedIds: Set<string>): string {
  const base =
    name
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

export function isOpenGraphCompatibleConfiguredVariant(
  variant: AdminEncoderVariant
): boolean {
  return variant.codec === "h264"
}

export function compatibleOpenGraphTarget(
  form: AdminEncoderConfig
): EncoderOpenGraphTarget {
  const firstCompatible = form.variants.find(
    isOpenGraphCompatibleConfiguredVariant
  )
  return firstCompatible
    ? { type: "variant", variantId: firstCompatible.id }
    : { type: "none" }
}

export function openGraphTargetIsCompatible(form: AdminEncoderConfig): boolean {
  const target = form.openGraphTarget
  if (target.type === "none") return true
  if (target.type === "source") return false
  if (target.type === "defaultVariant") {
    const defaultVariant = form.variants.find(
      (variant) => variant.id === form.defaultVariantId
    )
    return defaultVariant
      ? isOpenGraphCompatibleConfiguredVariant(defaultVariant)
      : false
  }
  const selected = form.variants.find(
    (variant) => variant.id === target.variantId
  )
  return selected ? isOpenGraphCompatibleConfiguredVariant(selected) : false
}

export function normalizeOpenGraphTarget(
  form: AdminEncoderConfig
): AdminEncoderConfig {
  return openGraphTargetIsCompatible(form)
    ? form
    : { ...form, openGraphTarget: compatibleOpenGraphTarget(form) }
}

export function openGraphValue(form: AdminEncoderConfig): string {
  const target = form.openGraphTarget
  return target.type === "variant" ? `variant:${target.variantId}` : target.type
}

export function openGraphDisplayLabel(form: AdminEncoderConfig): string {
  const target = form.openGraphTarget
  if (target.type === "none") return "No video"
  if (target.type === "source") return "Source MP4"
  if (target.type === "defaultVariant") return "Default playback variant"
  if (target.type === "variant") {
    const variant = form.variants.find((v) => v.id === target.variantId)
    return variant?.name ?? target.variantId
  }
  return "Unknown"
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
    const next = await api.admin.updateEncoderConfig(form)
    onChange(next)
    toast.success("Encoder updated")
    onSaved?.()
  } catch (cause) {
    toast.error(
      cause instanceof Error ? cause.message : "Couldn't update encoder"
    )
  } finally {
    setPending(false)
  }
}
