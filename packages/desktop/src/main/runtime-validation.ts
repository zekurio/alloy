import { t } from "@alloy/contracts/schema"

const UntrustedInputSchema = t.unknown()
const InvalidPrimitive = {}
export const StrictStringSchema = t.preprocess(
  (value) => parseString(value) ?? InvalidPrimitive,
  t.string(),
)
export const StrictBooleanSchema = t.preprocess(
  (value) => parseBoolean(value) ?? InvalidPrimitive,
  t.boolean(),
)
export const StrictFiniteNumberSchema = t.preprocess(
  (value) => parseFiniteNumber(value) ?? InvalidPrimitive,
  t.number(),
)
const NonnegativeIntegerSchema = StrictFiniteNumberSchema.int().nonnegative()
const UntrustedRecordSchema = t.record(t.string(), UntrustedInputSchema)

/** Input that must be decoded before domain code uses it. */
export type UntrustedInput = Parameters<
  typeof UntrustedInputSchema.safeParse
>[0]
export type UntrustedRecord = t.infer<typeof UntrustedRecordSchema>

export function parseUntrustedRecord(
  value: UntrustedInput,
): UntrustedRecord | null {
  const result = UntrustedRecordSchema.safeParse(value)
  return result.success ? result.data : null
}

export function parseString(value: UntrustedInput): string | null {
  if (Object(value) === value) return null
  try {
    return String.prototype.valueOf.call(value)
  } catch {
    return null
  }
}

export function parseBoolean(value: UntrustedInput): boolean | null {
  if (Object(value) === value) return null
  try {
    return Boolean.prototype.valueOf.call(value)
  } catch {
    return null
  }
}

export function parseFiniteNumber(value: UntrustedInput): number | null {
  if (Object(value) === value) return null
  try {
    const parsed = Number.prototype.valueOf.call(value)
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function parseNonnegativeInteger(value: UntrustedInput): number | null {
  const result = NonnegativeIntegerSchema.safeParse(value)
  return result.success ? result.data : null
}
