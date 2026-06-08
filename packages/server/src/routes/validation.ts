import { zValidator as baseZValidator } from "@hono/zod-validator"
import { z } from "zod"

type ZValidator = typeof baseZValidator
type ZValidatorArgs = Parameters<ZValidator>

type Issue = {
  path: string
  message: string
}

const TARGET_LABELS: Record<string, string> = {
  cookie: "cookies",
  form: "form data",
  header: "headers",
  json: "request body",
  param: "path parameters",
  query: "query parameters",
}

export const zValidator = ((
  target: ZValidatorArgs[0],
  schema: ZValidatorArgs[1],
  hook?: ZValidatorArgs[2],
  options?: ZValidatorArgs[3],
) =>
  baseZValidator(
    target,
    schema,
    async (result, c) => {
      if (!result.success) {
        return c.json(validationErrorBody(target, result.error), 400)
      }
      return hook?.(result, c)
    },
    options,
  )) as ZValidator

export function limitQueryParam(max: number, defaultValue: number) {
  return z.coerce.number().int().min(1).max(max).default(defaultValue)
}

export function offsetQueryParam(defaultValue = 0) {
  return z.coerce.number().int().min(0).default(defaultValue)
}

export function requiredTrimmedString(max?: number) {
  const schema = z.string().trim().min(1)
  return max === undefined ? schema : schema.max(max)
}

export function optionalTrimmedString(max?: number) {
  const schema = z.string().trim()
  return (max === undefined ? schema : schema.max(max)).optional()
}

export function optionalNullableTrimmedString(max?: number) {
  const schema = z.string().trim()
  return (max === undefined ? schema : schema.max(max)).optional().nullable()
}

export function optionalBlankToNullTrimmedString(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value.length > 0 ? value : null,
    )
}

export function optionalNullableBlankToNullTrimmedString(max: number) {
  return z
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

function validationErrorBody(target: string, error: unknown) {
  const issues = validationIssues(error)
  return {
    error: validationErrorMessage(target, issues),
    issues,
  }
}

function validationErrorMessage(target: string, issues: Issue[]): string {
  const label = TARGET_LABELS[target] ?? target
  const first = issues[0]
  if (!first) return `Invalid ${label}.`
  if (!first.path) return `Invalid ${label}: ${first.message}`
  return `Invalid ${label}: ${first.path}: ${first.message}`
}

function validationIssues(error: unknown): Issue[] {
  if (!error || typeof error !== "object") return []
  const rawIssues = (error as { issues?: unknown }).issues
  if (!Array.isArray(rawIssues)) return []
  return rawIssues.map((issue) => ({
    path: issuePath(issue),
    message: issueMessage(issue),
  }))
}

function issuePath(issue: unknown): string {
  if (!issue || typeof issue !== "object") return ""
  const path = (issue as { path?: unknown }).path
  if (!Array.isArray(path)) return ""
  return path.map(String).join(".")
}

function issueMessage(issue: unknown): string {
  if (!issue || typeof issue !== "object") return "Invalid value"
  const message = (issue as { message?: unknown }).message
  return typeof message === "string" && message.trim()
    ? message.trim()
    : "Invalid value"
}
