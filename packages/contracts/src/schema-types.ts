import type {
  Type,
  StaticDecode,
  StaticEncode,
  TArray,
  TCodec,
  TObject,
  TOptional,
  TProperties,
  TSchema,
  TUnion,
} from "typebox"

import type {
  RefinementContext,
  SafeParseResult,
  SchemaBoundaryInput,
} from "./schema-validation"

export const defaulted = Symbol("alloy.schema.defaulted")
const inputType = Symbol("alloy.schema.inputType")

type Defaulted = { [defaulted]: true }
export type InputType<Value> = { [inputType]: Value }

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

export type UnwrapProperties<Fields extends TProperties> = {
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
