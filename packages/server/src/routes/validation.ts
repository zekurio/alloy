import { safeParse, t } from "@alloy/contracts/schema"
import type { SchemaError, StaticInput } from "@alloy/contracts/schema"
import type {
  Context,
  Env,
  MiddlewareHandler,
  TypedResponse,
  ValidationTargets,
} from "hono"
import { validator } from "hono/validator"
import type { StaticDecode, TSchema } from "typebox"

type Hook<Value, AppEnv extends Env, Path extends string> = (
  result:
    | { success: true; data: Value }
    | { success: false; error: SchemaError },
  context: Context<AppEnv, Path>,
) => Response | Promise<Response> | void

type ExcludeResponse<Value> = Value extends Response & TypedResponse
  ? never
  : Value

export function tbValidator<
  const Schema extends TSchema,
  Target extends keyof ValidationTargets,
  AppEnv extends Env,
  Path extends string,
  Value extends {
    in: { [Key in Target]: StaticInput<Schema> }
    out: { [Key in Target]: ExcludeResponse<StaticDecode<Schema>> }
  },
>(
  target: Target,
  schema: Schema,
  hook?: Hook<StaticDecode<Schema>, AppEnv, Path>,
): MiddlewareHandler<AppEnv, Path, Value> {
  // SAFETY: safeParse returns the schema's decoded output on success, which
  // matches the Hono input and output mapping declared by Value.
  return validator(target, async (value, context) => {
    const result = safeParse(schema, value)
    if (result.success) {
      const response = hook?.(result, context)
      if (response) return response
      return result.data
    }

    const response = hook?.(result, context)
    if (response) return response
    return context.json(validationErrorBody(target, result.error), 400)
  }) as MiddlewareHandler<AppEnv, Path, Value>
}

export function limitQueryParam(max: number, defaultValue: number) {
  return t.coerce.number().int().min(1).max(max).$default(defaultValue)
}

export function offsetQueryParam(defaultValue = 0) {
  return t.coerce.number().int().min(0).$default(defaultValue)
}

export function requiredTrimmedString(max?: number) {
  const schema = t.string().trim().min(1)
  return max === undefined ? schema : schema.max(max)
}

export function optionalTrimmedString(max?: number) {
  const schema = t.string().trim()
  return (max === undefined ? schema : schema.max(max)).optional()
}

export function optionalNullableTrimmedString(max?: number) {
  const schema = t.string().trim()
  return (max === undefined ? schema : schema.max(max)).optional().nullable()
}

export function optionalBlankToNullTrimmedString(max: number) {
  return t
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value.length > 0 ? value : null,
    )
}

export function optionalNullableBlankToNullTrimmedString(max: number) {
  return t
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((value) =>
      value === undefined
        ? undefined
        : value && value.length > 0
          ? value
          : null,
    )
}

function validationErrorBody(target: string, error: SchemaError) {
  const issues = error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }))
  return {
    error: validationErrorMessage(target, issues),
    issues,
  }
}

function validationErrorMessage(
  target: string,
  issues: { path: string; message: string }[],
) {
  const labels = new Map<string, string>([
    ["cookie", "cookies"],
    ["form", "form data"],
    ["header", "headers"],
    ["json", "request body"],
    ["param", "path parameters"],
    ["query", "query parameters"],
  ])
  const first = issues[0]
  if (!first) return `Invalid ${labels.get(target) ?? target}.`
  if (!first.path)
    return `Invalid ${labels.get(target) ?? target}: ${first.message}`
  return `Invalid ${labels.get(target) ?? target}: ${first.path}: ${first.message}`
}
