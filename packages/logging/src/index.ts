import { inspect, styleText } from "node:util"

import { getLogContext, runWithLogContext } from "./context"

export interface Logger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

type LogLevel = "INFO" | "WARN" | "ERROR"

/** One log call, resolved into structured parts. */
interface LogRecord {
  timestamp: Date
  level: LogLevel
  /** Subsystem the logger was created for, e.g. "queue" or "sidecar". */
  scope?: string
  /** All arguments formatted and joined into the final message text. */
  message: string
  /** Ambient key=value context from `runWithLogContext`. */
  context: Record<string, string>
}

const jsonFormat = process.env.LOG_FORMAT === "json"

function formatLogArg(value: Parameters<typeof inspect>[0]): string {
  if (Object.prototype.toString.call(value) === "[object String]") {
    return String(value)
  }
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
  return Object.entries(ctx).sort((left, right) =>
    left[0].localeCompare(right[0]),
  )
}

/** One JSON object per line. Context keys never replace the record's own fields. */
function formatJsonRecord(record: LogRecord): string {
  const fields = {
    ts: record.timestamp.toISOString(),
    level: record.level,
    scope: record.scope,
    msg: record.message,
  }
  const context = sortedContextEntries(record.context).filter(
    ([key]) => !Object.hasOwn(fields, key),
  )
  return JSON.stringify({ ...fields, ...Object.fromEntries(context) })
}

type StyleFormat = Parameters<typeof styleText>[0]

const LEVEL_STYLE = {
  INFO: "green",
  WARN: "yellow",
  ERROR: ["red", "bold"],
} satisfies Record<LogLevel, StyleFormat>

/**
 * Render a record with ANSI colors for terminals. `styleText` degrades to
 * plain text when the stream is not a TTY or NO_COLOR is set, so this is safe
 * to use unconditionally for console output.
 */
function formatPrettyRecord(
  record: LogRecord,
  stream: NodeJS.WriteStream,
): string {
  const paint = (format: StyleFormat, text: string): string => {
    return styleText(format, text, { stream })
  }

  const ts = paint("dim", record.timestamp.toISOString())
  const level = paint(LEVEL_STYLE[record.level], record.level.padEnd(5))
  const contextSuffix = sortedContextEntries(record.context)
    .map((entry) => paint("dim", `${entry[0]}=${formatContextValue(entry[1])}`))
    .join(" ")
  const line = `${ts} ${level}${record.scope ? ` ${paint("cyan", `[${record.scope}]`)}` : ""} ${record.message}`
  return contextSuffix ? `${line} ${contextSuffix}` : line
}

function emit(level: LogLevel, scope: string | undefined, args: unknown[]) {
  const record: LogRecord = {
    timestamp: new Date(),
    level,
    scope,
    message: args.map(formatLogArg).join(" "),
    context: getLogContext(),
  }
  const stream = level === "INFO" ? process.stdout : process.stderr
  try {
    const line = jsonFormat
      ? formatJsonRecord(record)
      : formatPrettyRecord(record, stream)
    stream.write(`${line}\n`)
  } catch {
    // Logging must not make the primary operation fail.
  }
}

/** Create a logger whose records are tagged with a subsystem scope. */
export function createLogger(scope?: string): Logger {
  return {
    info(...args) {
      emit("INFO", scope, args)
    },
    warn(...args) {
      emit("WARN", scope, args)
    },
    error(...args) {
      emit("ERROR", scope, args)
    },
  }
}

/** Root logger for code that doesn't belong to a nameable subsystem. */
export const logger: Logger = createLogger()

export { getLogContext, runWithLogContext }
