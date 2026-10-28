import { isDeepStrictEqual } from "node:util"

import { isObjectRecord, type ContractJsonValue } from "@alloy/contracts"

/** Values saved for one config section; a missing key keeps its default. */
export type ConfigOverrides = Record<string, ContractJsonValue>

/**
 * Lay `override` over `base`. Objects merge key by key; anything else,
 * arrays and null included, replaces the base value whole.
 */
export function mergeConfig(
  base: ContractJsonValue,
  override: ContractJsonValue,
): ContractJsonValue {
  if (override === undefined) return base
  if (!isObjectRecord(base) || !isObjectRecord(override)) return override
  const merged = { ...base }
  for (const [key, value] of Object.entries(override)) {
    merged[key] = mergeConfig(base[key], value)
  }
  return merged
}

/**
 * The parts of `value` that differ from `defaults`, or undefined when there
 * are none. A key `value` leaves out is not an override: it falls back to
 * the default, so clearing an optional field hands it back to the
 * environment.
 */
export function configOverrides(
  value: ContractJsonValue,
  defaults: ContractJsonValue,
): ContractJsonValue {
  if (isObjectRecord(value) && isObjectRecord(defaults)) {
    const overrides: ConfigOverrides = {}
    for (const [key, child] of Object.entries(value)) {
      const override = configOverrides(child, defaults[key])
      if (override !== undefined) overrides[key] = override
    }
    return Object.keys(overrides).length > 0 ? overrides : undefined
  }
  return isDeepStrictEqual(value, defaults) ? undefined : value
}

/** The section's overrides as a storable object; {} when there are none. */
export function sectionOverrides(
  value: ContractJsonValue,
  defaults: ContractJsonValue,
): ConfigOverrides {
  const overrides = configOverrides(value, defaults)
  return isObjectRecord(overrides) ? overrides : {}
}

/** Read the value at `path`, or undefined when a step is missing. */
export function valueAtPath(
  value: ContractJsonValue,
  path: readonly string[],
): ContractJsonValue {
  let current = value
  for (const key of path) {
    if (!isObjectRecord(current)) return undefined
    current = current[key]
  }
  return current
}

/** Build a nested object holding `value` at `path`. */
export function objectAtPath(
  path: readonly string[],
  value: ContractJsonValue,
): ConfigOverrides {
  const [key, ...rest] = path
  if (key === undefined) return {}
  return Object.fromEntries([
    [key, rest.length > 0 ? objectAtPath(rest, value) : value],
  ])
}
