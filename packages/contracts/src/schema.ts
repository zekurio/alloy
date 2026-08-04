import { Type } from "typebox"
import type {
  StaticDecode,
  StaticEncode,
  TArray,
  TCodec,
  TEnum,
  TEnumValue,
  TObject,
  TOptional,
  TProperties,
  TNumber,
  TSchema,
  TUnion,
} from "typebox"
import { Check, Decode, Errors } from "typebox/value"

type ValidationIssue = {
  path: PropertyKey[]
  message: string
}

type RefinementContext = {
  addIssue(issue: ValidationIssue & { code?: string }): void
}

type SafeParseResult<Value> =
  | { success: true; data: Value }
  | { success: false; error: SchemaError }

const trimmed = Symbol("alloy.schema.trimmed")
const defaulted = Symbol("alloy.schema.defaulted")
const inputType = Symbol("alloy.schema.inputType")

type Defaulted = { [defaulted]: true }
type InputType<Value> = { [inputType]: Value }

type OptionalInputKeys<Fields extends TProperties> = {
  [Key in keyof Fields]: Fields[Key] extends TOptional | Defaulted ? Key : never
}[keyof Fields]

type ObjectInput<Fields extends TProperties> = {
  [Key in Exclude<keyof Fields, OptionalInputKeys<Fields>>]: StaticInput<
    Fields[Key]
  >
} & {
  [Key in OptionalInputKeys<Fields>]?: StaticInput<Fields[Key]>
}

export type StaticInput<SchemaType extends TSchema> =
  SchemaType extends InputType<infer Input>
    ? Input
    : SchemaType extends TArray<infer Items>
      ? StaticInput<Items>[]
      : SchemaType extends TUnion<infer Types>
        ? StaticInput<Types[number]>
        : SchemaType extends TObject<infer Fields>
          ? ObjectInput<Fields>
          : StaticEncode<SchemaType>

type UnwrapSchema<Value> =
  Value extends Schema<infer SchemaType>
    ? SchemaType
    : Value extends TSchema
      ? Value
      : never

type UnwrapProperties<Fields extends TProperties> = {
  [Key in keyof Fields]: UnwrapSchema<Fields[Key]>
}

type ExtendedObject<SchemaType extends TSchema, Fields extends TProperties> =
  SchemaType extends TObject<infer Existing>
    ? TObject<Existing & UnwrapProperties<Fields>>
    : TObject<UnwrapProperties<Fields>>

type SchemaMethods<SchemaType extends TSchema> = {
  readonly shape: SchemaType extends TObject<infer Fields>
    ? Fields
    : TProperties
  optional(): Schema<TOptional<SchemaType>>
  nullable(): Schema<TUnion<[SchemaType, ReturnType<typeof Type.Null>]>>
  $default(value: StaticDecode<SchemaType>): Schema<SchemaType & Defaulted>
  catch(value: StaticDecode<SchemaType>): Schema<SchemaType>
  refine(
    check: (value: StaticDecode<SchemaType>) => boolean,
    message?: string | { message?: string; path?: PropertyKey[] },
  ): Schema<SchemaType>
  superRefine(
    check: (
      value: StaticDecode<SchemaType>,
      context: RefinementContext,
    ) => void,
  ): Schema<SchemaType>
  transform<Output>(
    decode: (value: StaticDecode<SchemaType>) => Output,
  ): Schema<TCodec<SchemaType, Output>>
  trim(): Schema<SchemaType>
  min(value: number, message?: string): Schema<SchemaType>
  max(value: number, message?: string): Schema<SchemaType>
  int(): Schema<SchemaType>
  positive(): Schema<SchemaType>
  nonnegative(): Schema<SchemaType>
  multipleOf(value: number): Schema<SchemaType>
  regex(pattern: RegExp, message?: string): Schema<SchemaType>
  url(): Schema<SchemaType>
  uuid(): Schema<SchemaType>
  email(): Schema<SchemaType>
  datetime(options?: { offset?: boolean }): Schema<SchemaType>
  strict(): Schema<SchemaType>
  extend<Fields extends TProperties>(
    fields: Fields,
  ): Schema<ExtendedObject<SchemaType, Fields>>
  parse(value: unknown): StaticDecode<SchemaType>
  safeParse(value: unknown): SafeParseResult<StaticDecode<SchemaType>>
}

export type Schema<SchemaType extends TSchema = TSchema> = SchemaType &
  SchemaMethods<SchemaType>

export class SchemaError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues[0]?.message ?? "Invalid value")
  }
}

function schema<SchemaType extends TSchema>(
  value: SchemaType,
): Schema<SchemaType> {
  return new Proxy(value, {
    get(target, property, receiver) {
      const targetRecord = target as TSchema & Record<PropertyKey, unknown>
      if (property === "optional") {
        return () => schema(Type.Optional(target))
      }
      if (property === "nullable") {
        return () => schema(Type.Union([target, Type.Null()]))
      }
      if (property === "$default") {
        return (defaultValue: unknown) =>
          schema(
            Object.assign(copySchema(target, { default: defaultValue }), {
              [defaulted]: true as const,
            }),
          )
      }
      if (property === "catch") {
        return (defaultValue: unknown) =>
          schema(
            Type.Decode(Type.Unknown(), (input) => {
              const result = safeParse(target, input)
              return result.success ? result.data : defaultValue
            }),
          )
      }
      if (property === "refine") {
        return (
          check: (input: unknown) => boolean,
          options?: string | { message?: string },
        ) =>
          schema(
            Type.Refine(
              target,
              check,
              typeof options === "string"
                ? () => options
                : () => options?.message ?? "Invalid value",
            ),
          )
      }
      if (property === "superRefine") {
        return (check: (input: unknown, context: RefinementContext) => void) =>
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
        return (decode: (input: unknown) => unknown) =>
          schema(Type.Decode(target, decode))
      }
      if (property === "trim") {
        return () =>
          schema(
            Object.assign(
              Type.Decode(target, (input) =>
                typeof input === "string" ? input.trim() : input,
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
                ...(targetRecord.properties as TProperties | undefined),
                ...fields,
              },
              {
                additionalProperties: targetRecord.additionalProperties as
                  | boolean
                  | TSchema
                  | undefined,
              },
            ),
          )
      }
      if (property === "parse") return (input: unknown) => parse(target, input)
      if (property === "safeParse") {
        return (input: unknown) => safeParse(target, input)
      }
      return Reflect.get(target, property, receiver)
    },
  }) as Schema<SchemaType>
}

function withLimit(
  value: TSchema,
  kind: "min" | "max",
  limit: number,
  message?: string,
) {
  const valueRecord = value as TSchema & Record<PropertyKey, unknown>
  if (valueRecord[trimmed]) {
    return Type.Refine(
      value,
      (input) =>
        typeof input !== "string" ||
        (kind === "min"
          ? input.trim().length >= limit
          : input.trim().length <= limit),
      () => message ?? `Expected string length ${kind} ${limit}`,
    )
  }
  if (valueRecord.type === "string") {
    return copySchema(value, {
      [kind === "min" ? "minLength" : "maxLength"]: limit,
    })
  }
  if (valueRecord.type === "array") {
    return copySchema(value, {
      [kind === "min" ? "minItems" : "maxItems"]: limit,
    })
  }
  return copySchema(value, {
    [kind === "min" ? "minimum" : "maximum"]: limit,
  })
}

function withStringValidation(
  value: TSchema,
  options: { format?: string; pattern?: string },
) {
  const valueRecord = value as TSchema & Record<PropertyKey, unknown>
  if (!valueRecord[trimmed]) return copySchema(value, options)
  const validationSchema = Type.String(options)
  return Type.Refine(
    value,
    (input) =>
      typeof input === "string" && Check(validationSchema, input.trim()),
  )
}

function copySchema(
  value: TSchema,
  updates: Record<PropertyKey, unknown>,
  kind?: string,
) {
  const copy = Object.create(
    Object.getPrototypeOf(value),
    Object.getOwnPropertyDescriptors(value),
  ) as TSchema & Record<PropertyKey, unknown>
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
  value: unknown,
  check: (value: unknown, context: RefinementContext) => void,
) {
  const issues: ValidationIssue[] = []
  check(value, { addIssue: (issue) => issues.push(issue) })
  return issues
}

export function parse<SchemaType extends TSchema>(
  valueSchema: SchemaType,
  value: unknown,
): StaticDecode<SchemaType> {
  try {
    return Decode(valueSchema, value)
  } catch (cause) {
    throw schemaError(valueSchema, value, cause)
  }
}

export function safeParse<SchemaType extends TSchema>(
  valueSchema: SchemaType,
  value: unknown,
): SafeParseResult<StaticDecode<SchemaType>> {
  try {
    return { success: true, data: Decode(valueSchema, value) }
  } catch (cause) {
    return { success: false, error: schemaError(valueSchema, value, cause) }
  }
}

function schemaError(valueSchema: TSchema, value: unknown, cause: unknown) {
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
  if (!cause || typeof cause !== "object" || !("cause" in cause)) return null
  const details = cause.cause
  if (!details || typeof details !== "object" || !("errors" in details)) {
    return null
  }
  if (!Array.isArray(details.errors)) return null
  const errors = details.errors.filter(
    (error): error is { instancePath: string; message: string } =>
      Boolean(
        error &&
        typeof error === "object" &&
        "instancePath" in error &&
        typeof error.instancePath === "string" &&
        "message" in error &&
        typeof error.message === "string",
      ),
  )
  return errors.length > 0 ? errors : null
}

function object<Fields extends TProperties>(fields: Fields) {
  return schema(Type.Object(fields as UnwrapProperties<Fields>)) as Schema<
    TObject<UnwrapProperties<Fields>>
  >
}

function looseObject<Fields extends TProperties>(fields: Fields) {
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
    preprocess: (value: unknown) => unknown,
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
