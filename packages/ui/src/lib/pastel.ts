import { stableHue } from "./stable-hash"

export function pastelAvatarColors(seed: string | number): {
  bg: string
  fg: string
} {
  const hue = stableHue(seed || "user")
  return {
    bg: `oklch(0.82 0.08 ${hue})`,
    fg: `oklch(0.24 0.09 ${hue})`,
  }
}

export function pastelMediaGradient(seed: string | number): string {
  const hue = stableHue(seed || "media")
  return [
    "radial-gradient(120% 90% at 24% 18%,",
    `oklch(0.78 0.075 ${hue}) 0%,`,
    `oklch(0.58 0.06 ${(hue + 42) % 360}) 58%,`,
    `oklch(0.36 0.04 ${(hue + 86) % 360}) 100%)`,
  ].join(" ")
}

export function pastelBannerGradient(seed: string | number): string {
  const hue = stableHue(seed || "banner")
  return [
    "linear-gradient(135deg,",
    `oklch(0.78 0.075 ${hue}) 0%,`,
    `oklch(0.55 0.06 ${(hue + 38) % 360}) 58%,`,
    `oklch(0.34 0.04 ${(hue + 92) % 360}) 100%)`,
  ].join(" ")
}
