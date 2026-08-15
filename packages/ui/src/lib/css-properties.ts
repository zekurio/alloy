import type { CSSProperties } from "react"

/** React style values plus the CSS custom properties used by Alloy themes. */
export type CSSVariableProperties = CSSProperties & {
  [property: `--${string}`]: string | number | undefined
}

export function cssVariables(properties: CSSVariableProperties): CSSProperties {
  return properties
}
