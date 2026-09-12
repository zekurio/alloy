import { Type } from "typebox"
import type { StaticDecode, TSchema } from "typebox"
import { Check, Decode, Errors } from "typebox/value"

const stringSchema = Type.String()

export type ValidationIssue = {
  path: PropertyKey[]
  message: string
}

export type SchemaBoundaryInput = Parameters<typeof Decode>[2]

export type RefinementContext = {
  addIssue(issue: ValidationIssue & { code?: string }): void
}

export type SafeParseResult<Value> =
  | { success: true; data: Value }
  | { success: false; error: SchemaError }

export class SchemaError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues[0]?.message ?? "Invalid value")
  }
}

export function parse<SchemaType extends TSchema>(
  valueSchema: SchemaType,
  value: SchemaBoundaryInput,
): StaticDecode<SchemaType> {
  try {
    return Decode(valueSchema, value)
  } catch (cause) {
    throw schemaError(valueSchema, value, cause)
  }
}

export function safeParse<SchemaType extends TSchema>(
  valueSchema: SchemaType,
  value: SchemaBoundaryInput,
): SafeParseResult<StaticDecode<SchemaType>> {
  try {
    return { success: true, data: Decode(valueSchema, value) }
  } catch (cause) {
    return { success: false, error: schemaError(valueSchema, value, cause) }
  }
}

function schemaError(
  valueSchema: TSchema,
  value: SchemaBoundaryInput,
  cause: unknown,
) {
  const errors = decodeErrors(cause) ?? [...Errors(valueSchema, value)]
  return new SchemaError(
    errors.map((error) => ({
      path: error.instancePath
        .split("/")
        .slice(1)
        .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~")),
      message: error.message,
    })),
  )
}

function decodeErrors(cause: unknown) {
  if (!(cause instanceof Error) || !("cause" in cause)) return null
  const details = cause.cause
  if (!(details instanceof Object) || !("errors" in details)) {
    return null
  }
  if (!Array.isArray(details.errors)) return null
  const errors = details.errors.filter(
    (error): error is { instancePath: string; message: string } =>
      Boolean(
        error instanceof Object &&
        "instancePath" in error &&
        Check(stringSchema, error.instancePath) &&
        "message" in error &&
        Check(stringSchema, error.message),
      ),
  )
  return errors.length > 0 ? errors : null
}
