import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs))
}

export function sliderValue(
  value: number | readonly number[],
  fallback = 0,
): number {
  return typeof value === "number" ? value : (value[0] ?? fallback)
}
