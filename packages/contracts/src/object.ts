import { Type } from "typebox"
import { Check } from "typebox/value"

import type { ContractJsonInput, ContractJsonValue } from "./json-value"

const BOOLEAN_VALUE_SCHEMA = Type.Boolean()
const NUMBER_VALUE_SCHEMA = Type.Number()
const OBJECT_RECORD_SCHEMA = Type.Object({}, { additionalProperties: true })
const STRING_VALUE_SCHEMA = Type.String()

export function isObjectRecord(
  value: ContractJsonInput,
): value is Record<string, ContractJsonValue> {
  return Check(OBJECT_RECORD_SCHEMA, value)
}

export function isStringValue(value: ContractJsonInput): value is string {
  return Check(STRING_VALUE_SCHEMA, value)
}

export function isFiniteNumberValue(value: ContractJsonInput): value is number {
  return Check(NUMBER_VALUE_SCHEMA, value)
}

export function isBooleanValue(value: ContractJsonInput): value is boolean {
  return Check(BOOLEAN_VALUE_SCHEMA, value)
}
