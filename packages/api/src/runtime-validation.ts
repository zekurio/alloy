export function objectRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label} response`)
  }
  return value as Record<string, unknown>
}

export function validateArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(message)
  return value
}

export function validateStringArray(value: unknown, message: string): string[] {
  const items = validateArray(value, message)
  if (items.some((item) => typeof item !== "string")) throw new Error(message)
  return items as string[]
}

export function validateStringRecord(
  value: unknown,
  label: string,
  message: string,
): Record<string, string> {
  const record = objectRecord(value, label)
  for (const [key, item] of Object.entries(record)) {
    if (!key.trim() || typeof item !== "string") throw new Error(message)
  }
  return record as Record<string, string>
}

export function validateBatchProgress<T extends string>(
  value: unknown,
  label: string,
  countKey: T,
): Record<T, number> & { hasMore: boolean } {
  const response = objectRecord(value, label)
  validateNonNegativeInteger(
    response[countKey],
    `Invalid ${label} response: ${countKey} must be a non-negative integer`,
  )
  validateBoolean(
    response.hasMore,
    `Invalid ${label} response: hasMore must be boolean`,
  )
  return value as Record<T, number> & { hasMore: boolean }
}

export function validateBoolean(value: unknown, message: string) {
  if (typeof value !== "boolean") throw new Error(message)
}

export function validateString(
  value: unknown,
  message: string,
): asserts value is string {
  if (typeof value !== "string") throw new Error(message)
}

export function validateEnumString(
  value: unknown,
  allowedValues: ReadonlySet<string>,
  message: string,
): asserts value is string {
  if (typeof value !== "string" || !allowedValues.has(value)) {
    throw new Error(message)
  }
}

export function validateNullableEnumString(
  value: unknown,
  allowedValues: ReadonlySet<string>,
  message: string,
): asserts value is string | null {
  if (value !== null) validateEnumString(value, allowedValues, message)
}

export function validateRequiredString(
  value: unknown,
  message: string,
): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(message)
}

export function validateOptionalString(value: unknown, message: string) {
  if (value !== undefined) validateString(value, message)
}

export function validateUrlString(
  value: unknown,
  message: string,
): asserts value is string {
  if (typeof value !== "string") throw new Error(message)
  try {
    new URL(value)
  } catch {
    throw new Error(message)
  }
}

export function validateOptionalUrlString(value: unknown, message: string) {
  if (value !== undefined) validateUrlString(value, message)
}

export function validateNullableUrlString(
  value: unknown,
  message: string,
): asserts value is string | null {
  if (value !== null) validateUrlString(value, message)
}

export function validateNullableString(
  value: unknown,
  message: string,
): asserts value is string | null {
  if (value !== null) validateString(value, message)
}

export function validateNullableRequiredString(
  value: unknown,
  message: string,
): asserts value is string | null {
  if (value !== null) validateRequiredString(value, message)
}

export function validateNumber(
  value: unknown,
  message: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(message)
  }
}

export function validatePositiveInteger(value: unknown, message: string) {
  validateNumber(value, message)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(message)
  }
}

export function validateNonNegativeInteger(value: unknown, message: string) {
  validateNumber(value, message)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(message)
  }
}

export function validateNullableNonNegativeInteger(
  value: unknown,
  message: string,
) {
  if (value !== null) validateNonNegativeInteger(value, message)
}

export function validateNullablePositiveInteger(
  value: unknown,
  message: string,
) {
  if (value !== null) validatePositiveInteger(value, message)
}

export function validateIntegerInRange(
  value: unknown,
  min: number,
  max: number,
  message: string,
) {
  validateNumber(value, message)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(message)
  }
}

export function validateEvenIntegerInRange(
  value: unknown,
  min: number,
  max: number,
  message: string,
) {
  validateIntegerInRange(value, min, max, message)
  const numberValue = value as number
  if (numberValue % 2 !== 0) {
    throw new Error(message)
  }
}

export function validateNonNegativeNumber(
  value: unknown,
  message: string,
): number {
  validateNumber(value, message)
  if (value < 0) {
    throw new Error(message.replace("numeric", "non-negative"))
  }
  return value
}

function isCanonicalIsoDateString(value: string): boolean {
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString() === value
}

export function validateIsoDateString(
  value: unknown,
  message: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    !isCanonicalIsoDateString(value)
  ) {
    throw new Error(message)
  }
}

export function validateNullableDateString(value: unknown, message: string) {
  if (value !== null) validateIsoDateString(value, message)
}
