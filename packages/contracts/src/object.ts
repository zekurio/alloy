import type { ContractJsonValue } from "./json-value"

export function isObjectRecord(
  value: unknown,
): value is Record<string, ContractJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isStringValue(value: unknown): value is string {
  return typeof value === "string"
}

export function isFiniteNumberValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}
