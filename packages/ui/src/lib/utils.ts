export { cn } from "cn"

export function sliderValue(
  value: number | readonly number[],
  fallback = 0,
): number {
  return isSliderRange(value) ? (value[0] ?? fallback) : value
}

function isSliderRange(
  value: number | readonly number[],
): value is readonly number[] {
  return Array.isArray(value)
}
