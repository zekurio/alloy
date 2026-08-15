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

type SchemaBoundaryInput = Parameters<typeof Decode>[2]

type RefinementContext = {
  addIssue(issue: ValidationIssue & { code?: string }): void
}

type SafeParseResult<Value> =
  | { success: true; data: Value }
  | { success: false; error: SchemaError }

const trimmed = Symbol("alloy.schema.trimmed")
const defaulted = Symbol("alloy.schema.defaulted")
const inputType = Symbol("alloy.schema.inputType")
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
  readonly ["shape"]: SchemaType extends TObject<infer Fields>
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
  parse(value: SchemaBoundaryInput): StaticDecode<SchemaType>
  safeParse(
    value: SchemaBoundaryInput,
  ): SafeParseResult<StaticDecode<SchemaType>>
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
