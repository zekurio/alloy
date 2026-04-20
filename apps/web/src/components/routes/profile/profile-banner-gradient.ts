import * as React from "react"

import { env } from "../../../lib/env"

type Rgb = { r: number; g: number; b: number }
type AvatarPalette = { left: Rgb; right: Rgb; overall: Rgb }

const BLACK: Rgb = { r: 0, g: 0, b: 0 }
const WHITE: Rgb = { r: 255, g: 255, b: 255 }

export function useBannerGradient(
  imageSrc: string | null | undefined,
  username: string,
  fallbackSeed: string
): React.CSSProperties {
  const [palette, setPalette] = React.useState<AvatarPalette | null>(null)

  React.useEffect(() => {
    setPalette(null)
    if (!imageSrc) return
    if (typeof window === "undefined") return

    let cancelled = false
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.decoding = "async"
    img.onload = () => {
      if (cancelled) return
      try {
        const next = samplePalette(img)
        if (next) setPalette(next)
      } catch {
        return
      }
    }
    img.src = `${env.VITE_API_URL}/api/users/${encodeURIComponent(username)}/avatar`
    return () => {
      cancelled = true
      img.onload = null
    }
  }, [imageSrc, username])

  return palette ? paletteGradient(palette) : bannerGradient(fallbackSeed)
}

function samplePalette(img: HTMLImageElement): AvatarPalette | null {
  const size = 32
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)

  const averageRegion = (x0: number, x1: number): Rgb => {
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let y = 0; y < size; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * size + x) * 4
        const alpha = data[i + 3] ?? 0
        if (alpha < 32) continue
        r += data[i] ?? 0
        g += data[i + 1] ?? 0
        b += data[i + 2] ?? 0
        n++
      }
    }
    if (n === 0) return BLACK
    return { r: r / n, g: g / n, b: b / n }
  }

  return {
    left: averageRegion(0, size / 2),
    right: averageRegion(size / 2, size),
    overall: averageRegion(0, size),
  }
}

function mix(color: Rgb, target: Rgb, t: number): Rgb {
  return {
    r: color.r + (target.r - color.r) * t,
    g: color.g + (target.g - color.g) * t,
    b: color.b + (target.b - color.b) * t,
  }
}

function formatRgb({ r, g, b }: Rgb): string {
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`
}

function paletteGradient({
  left,
  right,
  overall,
}: AvatarPalette): React.CSSProperties {
  const highlight = mix(left, WHITE, 0.15)
  const baseStart = mix(overall, BLACK, 0.5)
  const baseEnd = mix(overall, BLACK, 0.75)
  return {
    background: [
      `radial-gradient(120% 140% at 0% 0%, ${formatRgb(highlight)} 0%, transparent 55%)`,
      `radial-gradient(120% 140% at 100% 0%, ${formatRgb(right)} 0%, transparent 60%)`,
      `linear-gradient(135deg, ${formatRgb(baseStart)} 0%, ${formatRgb(baseEnd)} 100%)`,
    ].join(", "),
  }
}

function bannerGradient(seed: string): React.CSSProperties {
  let h = 0
  const key = seed || "user"
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0
  }
  const hue = h % 360
  return {
    background: [
      `radial-gradient(120% 140% at 0% 0%, oklch(0.42 0.18 ${hue}) 0%, transparent 55%)`,
      `radial-gradient(120% 140% at 100% 0%, oklch(0.32 0.18 ${hue}) 0%, transparent 60%)`,
      `linear-gradient(135deg, oklch(0.22 0.12 ${hue}) 0%, oklch(0.14 0.06 ${hue}) 100%)`,
    ].join(", "),
  }
}
