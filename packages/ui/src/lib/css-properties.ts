import type { CSSProperties } from "react"

type CSSVariableProperties = CSSProperties & {
  [property: `--${string}`]: string | number | undefined
}

export function cssVariables(properties: CSSVariableProperties): CSSProperties {
  return properties
}
