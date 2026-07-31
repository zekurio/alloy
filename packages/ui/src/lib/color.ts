export interface Rgba {
  r: number
  g: number
  b: number
  /** 0-1. */
  a: number
}

export interface Hsva {
  /** 0-360. */
  h: number
  /** 0-1. */
  s: number
  /** 0-1. */
  v: number
  /** 0-1. */
  a: number
}

/**
 * Resolves any CSS colour — `#abc`, `rgb()`, `hsl()`, `oklch()`, a keyword — to
 * channels, by handing it to a canvas and reading back the serialised form. The
 * browser owns every colour space this way, so the picker keeps working with
 * whatever the stylesheet happens to use.
 *
 * Returns null when the value isn't a colour at all (`var(--x)`, `color-mix()`
 * on engines that won't serialise it, typos mid-edit).
 */
export function parseCssColor(value: string): Rgba | null {
  const input = value.trim()
  if (!input) return null

  const context = measurementContext()
  if (!context) return parseHex(input)

  // fillStyle keeps its previous value when handed something invalid, so
  // probing twice from different defaults tells valid-black from rejected.
  context.fillStyle = "#000000"
  context.fillStyle = input
  const fromBlack = context.fillStyle
  context.fillStyle = "#ffffff"
  context.fillStyle = input
  if (context.fillStyle !== fromBlack) return null

  return parseHex(fromBlack) ?? parseRgbFunction(fromBlack)
}

let sharedContext: CanvasRenderingContext2D | null | undefined

function measurementContext(): CanvasRenderingContext2D | null {
  if (sharedContext !== undefined) return sharedContext
  if (typeof document === "undefined") return (sharedContext = null)
  sharedContext = document.createElement("canvas").getContext("2d")
  return sharedContext
}

function parseHex(value: string): Rgba | null {
  const match = value.trim().match(/^#([0-9a-f]{3,8})$/i)
  const digits = match?.[1]
  if (!digits) return null

  const expand = (part: string) =>
    part.length === 1
      ? Number.parseInt(part + part, 16)
      : Number.parseInt(part, 16)

  if (digits.length === 3 || digits.length === 4) {
    return {
      r: expand(digits.slice(0, 1)),
      g: expand(digits.slice(1, 2)),
      b: expand(digits.slice(2, 3)),
      a: digits.length === 4 ? expand(digits.slice(3, 4)) / 255 : 1,
    }
  }
  if (digits.length === 6 || digits.length === 8) {
    return {
      r: Number.parseInt(digits.slice(0, 2), 16),
      g: Number.parseInt(digits.slice(2, 4), 16),
      b: Number.parseInt(digits.slice(4, 6), 16),
      a:
        digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1,
    }
  }
  return null
}

function parseRgbFunction(value: string): Rgba | null {
  const parts = value.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i,
  )
  if (!parts) return null
  return {
    r: Number(parts[1]),
    g: Number(parts[2]),
    b: Number(parts[3]),
    a: parts[4] === undefined ? 1 : Number(parts[4]),
  }
}

export function formatCssColor({ r, g, b, a }: Rgba): string {
  if (a >= 1) {
    const hex = [r, g, b]
      .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
      .join("")
    return `#${hex}`
  }
  // Authors write rgba() for translucent tokens (--accent-soft, --accent-glow),
  // so round-tripping one keeps the diff to the value that actually changed.
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Number(a.toFixed(3))})`
}

export function rgbaToHsva({ r, g, b, a }: Rgba): Hsva {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const span = max - Math.min(red, green, blue)

  const hue =
    span === 0
      ? 0
      : max === red
        ? 60 * (((green - blue) / span + 6) % 6)
        : max === green
          ? 60 * ((blue - red) / span + 2)
          : 60 * ((red - green) / span + 4)

  return { h: hue, s: max === 0 ? 0 : span / max, v: max, a }
}

export function hsvaToRgba({ h, s, v, a }: Hsva): Rgba {
  const chroma = v * s
  const secondary = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const base = v - chroma
  const sector = Math.floor(h / 60) % 6
  const [r, g, b] = (
    [
      [chroma, secondary, 0],
      [secondary, chroma, 0],
      [0, chroma, secondary],
      [0, secondary, chroma],
      [secondary, 0, chroma],
      [chroma, 0, secondary],
    ] as const
  )[sector] ?? [0, 0, 0]

  return {
    r: Math.round((r + base) * 255),
    g: Math.round((g + base) * 255),
    b: Math.round((b + base) * 255),
    a,
  }
}

/** Opaque form of a colour, for the picker's saturation/value field. */
export function hueColor(hue: number): string {
  return formatCssColor(hsvaToRgba({ h: hue, s: 1, v: 1, a: 1 }))
}
