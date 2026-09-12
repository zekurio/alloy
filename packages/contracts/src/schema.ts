import { Type } from "typebox"
import type {
  StaticDecode,
  TArray,
  TEnum,
  TEnumValue,
  TObject,
  TProperties,
  TNumber,
  TSchema,
} from "typebox"
import { Check } from "typebox/value"

import {
  defaulted,
  type InputType,
  type Schema,
  type UnwrapProperties,
} from "./schema-types"
import {
  parse,
  safeParse,
  type SchemaError,
  type SchemaBoundaryInput,
  type RefinementContext,
  type ValidationIssue,
} from "./schema-validation"

export type { Schema, StaticInput } from "./schema-types"
export { parse, safeParse, SchemaError } from "./schema-validation"

const trimmed = Symbol("alloy.schema.trimmed")
const stringSchema = Type.String()

type SchemaMetadata = {
  [defaulted]?: true
  [trimmed]?: true
  additionalProperties?: boolean | TSchema
  default?: SchemaBoundaryInput
  properties?: TProperties
  type?: string
}

type SchemaUpdates = {
  additionalProperties?: boolean | TSchema
  default?: SchemaBoundaryInput
  exclusiveMinimum?: number
  format?: string
  maximum?: number
  maxItems?: number
  maxLength?: number
  minimum?: number
  minItems?: number
  minLength?: number
  multipleOf?: number
  pattern?: string
  type?: string
}

function schema<SchemaType extends TSchema>(
  value: SchemaType,
): Schema<SchemaType> {
  // SAFETY: The proxy preserves the schema and provides every declared adapter method.
  return new Proxy(value, {
    get(target, property) {
      // SAFETY: These are the metadata fields that this adapter writes and reads.
      const targetRecord = target as TSchema & SchemaMetadata
      if (property === "optional") {
        return () => schema(Type.Optional(target))
      }
      if (property === "nullable") {
        return () => schema(Type.Union([target, Type.Null()]))
      }
      if (property === "$default") {
        return (defaultValue: SchemaBoundaryInput) =>
          schema(
            Object.assign(copySchema(target, { default: defaultValue }), {
              [defaulted]: true as const,
            }),
          )
      }
      if (property === "catch") {
        return (defaultValue: SchemaBoundaryInput) => {
          const caught = Type.Decode(Type.Unknown(), (input) => {
            const result = safeParse(target, input)
            return result.success ? result.data : defaultValue
          })
          return schema(
            targetRecord[defaulted]
              ? Object.assign(caught, {
                  default: targetRecord.default,
                  [defaulted]: true as const,
                })
              : caught,
          )
        }
      }
      if (property === "refine") {
        return (
          check: (input: SchemaBoundaryInput) => boolean,
          options?: string | { message?: string },
        ) => {
          const message = Check(stringSchema, options)
            ? options
            : options?.message
          return schema(
            Type.Refine(target, check, () => message ?? "Invalid value"),
          )
        }
      }
      if (property === "superRefine") {
        return (
          check: (
            input: SchemaBoundaryInput,
            context: RefinementContext,
          ) => void,
        ) =>
          schema(
            Type.Refine(
              target,
              (input) => refinementIssues(input, check).length === 0,
              (input) =>
                refinementIssues(input, check)[0]?.message ?? "Invalid value",
            ),
          )
      }
      if (property === "transform") {
        return (decode: (input: SchemaBoundaryInput) => SchemaBoundaryInput) =>
          schema(Type.Decode(target, decode))
      }
      if (property === "trim") {
        return () =>
          schema(
            Object.assign(
              Type.Decode(target, (input) =>
                Check(stringSchema, input) ? input.trim() : input,
              ),
              { [trimmed]: true },
            ),
          )
      }
      if (property === "min" || property === "max") {
        return (limit: number, message?: string) =>
          schema(withLimit(target, property, limit, message))
      }
      if (property === "int") {
        return () => schema(copySchema(target, { type: "integer" }, "Integer"))
      }
      if (property === "positive") {
        return () => schema(copySchema(target, { exclusiveMinimum: 0 }))
      }
      if (property === "nonnegative") {
        return () => schema(copySchema(target, { minimum: 0 }))
      }
      if (property === "multipleOf") {
        return (multipleOf: number) =>
          schema(copySchema(target, { multipleOf }))
      }
      if (property === "regex") {
        return (pattern: RegExp) =>
          schema(withStringValidation(target, { pattern: pattern.source }))
      }
      if (property === "url") {
        return () => schema(withStringValidation(target, { format: "uri" }))
      }
      if (property === "uuid") {
        return () => schema(withStringValidation(target, { format: "uuid" }))
      }
      if (property === "email") {
        return () => schema(withStringValidation(target, { format: "email" }))
      }
      if (property === "datetime") {
        return () =>
          schema(withStringValidation(target, { format: "date-time" }))
      }
      if (property === "strict") {
        return () => schema(copySchema(target, { additionalProperties: false }))
      }
      if (property === "shape") return targetRecord.properties
      if (property === "extend") {
        return (fields: TProperties) =>
          schema(
            Type.Object(
              {
                ...targetRecord.properties,
                ...fields,
              },
              {
                additionalProperties: targetRecord.additionalProperties,
              },
            ),
          )
      }
      if (property === "parse")
        return (input: SchemaBoundaryInput) => parse(target, input)
      if (property === "safeParse") {
        return (input: SchemaBoundaryInput) => safeParse(target, input)
      }
      // SAFETY: The proxy forwards only property keys read from the wrapped schema.
      return target[property as keyof SchemaType]
    },
  }) as Schema<SchemaType>
}

function withLimit(
  value: TSchema,
  kind: "min" | "max",
  limit: number,
  message?: string,
) {
  // SAFETY: TypeBox schemas store their validation keywords as own metadata.
  const valueRecord = value as TSchema & SchemaMetadata
  if (valueRecord[trimmed]) {
    return Type.Refine(
      value,
      (input) =>
        !Check(stringSchema, input) ||
        (kind === "min"
          ? input.trim().length >= limit
          : input.trim().length <= limit),
      () => message ?? `Expected string length ${kind} ${limit}`,
    )
  }
  if (valueRecord.type === "string") {
    return kind === "min"
      ? copySchema(value, { minLength: limit })
      : copySchema(value, { maxLength: limit })
  }
  if (valueRecord.type === "array") {
    return kind === "min"
      ? copySchema(value, { minItems: limit })
      : copySchema(value, { maxItems: limit })
  }
  return kind === "min"
    ? copySchema(value, { minimum: limit })
    : copySchema(value, { maximum: limit })
}

function withStringValidation(
  value: TSchema,
  options: { format?: string; pattern?: string },
) {
  // SAFETY: TypeBox schemas store their validation keywords as own metadata.
  const valueRecord = value as TSchema & SchemaMetadata
  if (!valueRecord[trimmed]) return copySchema(value, options)
  const validationSchema = Type.String(options)
  return Type.Refine(
    value,
    (input) =>
      Check(stringSchema, input) && Check(validationSchema, input.trim()),
  )
}

function copySchema(value: TSchema, updates: SchemaUpdates, kind?: string) {
  // SAFETY: The clone keeps the TypeBox schema prototype and all descriptors.
  const copy = Object.create(
    Object.getPrototypeOf(value),
    Object.getOwnPropertyDescriptors(value),
  ) as TSchema & SchemaMetadata
  Object.assign(copy, updates)
  if (kind) {
    Object.defineProperty(copy, "~kind", {
      value: kind,
      writable: true,
      configurable: true,
    })
  }
  return copy
}

function refinementIssues(
  value: SchemaBoundaryInput,
  check: (value: SchemaBoundaryInput, context: RefinementContext) => void,
) {
  const issues: ValidationIssue[] = []
  check(value, { addIssue: (issue) => issues.push(issue) })
  return issues
}

function object<Fields extends TProperties>(fields: Fields) {
  // SAFETY: UnwrapProperties matches the runtime schema values passed to Type.Object.
  return schema(Type.Object(fields as UnwrapProperties<Fields>)) as Schema<
    TObject<UnwrapProperties<Fields>>
  >
}

function looseObject<Fields extends TProperties>(fields: Fields) {
  // SAFETY: UnwrapProperties matches the runtime schema values passed to Type.Object.
  return schema(
    Type.Object(fields as UnwrapProperties<Fields>, {
      additionalProperties: true,
    }),
  ) as Schema<TObject<UnwrapProperties<Fields>>>
}

function array<Items extends TSchema>(items: Items): Schema<TArray<Items>> {
  return schema(Type.Array(items))
}

function enumSchema<Values extends TEnumValue[]>(
  values: readonly [...Values],
): Schema<TEnum<Values>> {
  return schema(Type.Enum(values))
}

export const t = {
  array,
  boolean: () => schema(Type.Boolean()),
  coerce: {
    // SAFETY: This changes only the accepted input type; the decoded value stays numeric.
    number: () =>
      schema(Type.Number()) as Schema<TNumber & InputType<string | number>>,
  },
  enum: enumSchema,
  flattenError: (error: SchemaError) => ({
    fieldErrors: groupIssues(error.issues),
  }),
  instanceof: <Value>(
    constructor: abstract new (...args: never[]) => Value,
    _options?: { message?: string },
  ) =>
    schema(
      Type.Refine(
        Type.Unsafe<Value>(Type.Unknown()),
        (value) => value instanceof constructor,
      ),
    ),
  iso: {
    datetime: (_options?: { offset?: boolean }) =>
      schema(Type.String({ format: "date-time" })),
  },
  looseObject,
  number: () => schema(Type.Number()),
  object,
  preprocess: <SchemaType extends TSchema>(
    preprocess: (value: SchemaBoundaryInput) => SchemaBoundaryInput,
    valueSchema: SchemaType,
  ) =>
    schema(
      Type.Decode(Type.Unknown(), (value) =>
        parse(valueSchema, preprocess(value)),
      ),
    ),
  prettifyError: (error: SchemaError) =>
    error.issues
      .map((issue) =>
        issue.path.length > 0
          ? `${issue.path.map(String).join(".")}: ${issue.message}`
          : issue.message,
      )
      .join("\n"),
  record: <Value extends TSchema>(_key: TSchema, value: Value) =>
    schema(Type.Record(Type.String(), value)),
  string: () => schema(Type.String()),
  union: <Types extends TSchema[]>(types: [...Types]) =>
    schema(Type.Union(types)),
  unknown: () => schema(Type.Unknown()),
  url: () => schema(Type.String({ format: "uri" })),
  uuid: () => schema(Type.String({ format: "uuid" })),
}

export namespace t {
  export type infer<SchemaType extends TSchema> = StaticDecode<SchemaType>
  export type output<SchemaType extends TSchema> = StaticDecode<SchemaType>
  export type RefinementCtx = RefinementContext
}

function groupIssues(issues: ValidationIssue[]) {
  return issues.reduce<Record<string, ValidationIssue[]>>((groups, issue) => {
    const key = String(issue.path[0] ?? "")
    groups[key] = [...(groups[key] ?? []), issue]
    return groups
  }, {})
}
