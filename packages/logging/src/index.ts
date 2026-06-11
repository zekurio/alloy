import { inspect } from "node:util"

import { getLogContext, runWithLogContext } from "./context"

type LogWriter = Pick<NodeJS.WriteStream, "write">

export interface Logger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export type LogLevel = "INFO" | "WARN" | "ERROR"
export type LogFormat = "human" | "json"

const initialLogFormat = process.env.LOG_FORMAT === "json" ? "json" : "human"
let logFormat: LogFormat = initialLogFormat

function formatLogArg(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`
  }
  return inspect(value, { colors: false, depth: 6 })
}

function formatContextValue(value: string): string {
  if (/^[^\s=]+$/.test(value)) return value
  return JSON.stringify(value)
}

function sortedContextEntries(ctx: Record<string, string>): [string, string][] {
  return Object.entries(ctx).sort(([left], [right]) =>
    left.localeCompare(right),
  )
}

export function formatLine(
  level: LogLevel,
  args: readonly unknown[],
  ctx: Record<string, string>,
  timestamp: Date,
  format: LogFormat = logFormat,
): string {
  const ts = timestamp.toISOString()
  const msg = args.map(formatLogArg).join(" ")
  if (format === "json") {
    return JSON.stringify({
      ts,
      level,
      msg,
      ...Object.fromEntries(sortedContextEntries(ctx)),
    })
  }

  const contextSuffix = sortedContextEntries(ctx)
    .map(([key, value]) => `${key}=${formatContextValue(value)}`)
    .join(" ")
  const prefix = `${ts} ${level.padEnd(5)}`
  return contextSuffix
    ? `${prefix} ${msg} ${contextSuffix}`
    : `${prefix} ${msg}`
}

function writeLogLine(
  writer: LogWriter,
  level: LogLevel,
  args: unknown[],
): void {
  try {
    writer.write(`${formatLine(level, args, getLogContext(), new Date())}\n`)
  } catch {
    // Logging must not make the primary operation fail.
  }
}

export const logger: Logger = {
  info(...args) {
    writeLogLine(process.stdout, "INFO", args)
  },
  warn(...args) {
    writeLogLine(process.stderr, "WARN", args)
  },
  error(...args) {
    writeLogLine(process.stderr, "ERROR", args)
  },
}

export { getLogContext, runWithLogContext }

export function setLogFormatForTest(format: LogFormat): void {
  logFormat = format
}

export function resetLogFormatForTest(): void {
  logFormat = initialLogFormat
}
