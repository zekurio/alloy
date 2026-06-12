import { inspect, styleText } from "node:util"

import { getLogContext, runWithLogContext } from "./context"

export interface Logger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export type LogLevel = "INFO" | "WARN" | "ERROR"
export type LogFormat = "human" | "json"

/** One log call, resolved into structured parts that every sink receives. */
export interface LogRecord {
  timestamp: Date
  level: LogLevel
  /** Subsystem the logger was created for, e.g. "queue" or "sidecar". */
  scope?: string
  /** All arguments formatted and joined into the final message text. */
  message: string
  /** Ambient key=value context from `runWithLogContext`. */
  context: Record<string, string>
}

export interface LogSink {
  write(record: LogRecord): void
}

const logFormat: LogFormat =
  process.env.LOG_FORMAT === "json" ? "json" : "human"

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

/** Render a record without colors — for files, pipes, and JSON ingestion. */
export function formatRecord(record: LogRecord, format: LogFormat): string {
  const ts = record.timestamp.toISOString()
  if (format === "json") {
    return JSON.stringify({
      ts,
      level: record.level,
      ...(record.scope ? { scope: record.scope } : {}),
      msg: record.message,
      ...Object.fromEntries(sortedContextEntries(record.context)),
    })
  }

  const scope = record.scope ? ` [${record.scope}]` : ""
  const contextSuffix = sortedContextEntries(record.context)
    .map(([key, value]) => `${key}=${formatContextValue(value)}`)
    .join(" ")
  const line = `${ts} ${record.level.padEnd(5)}${scope} ${record.message}`
  return contextSuffix ? `${line} ${contextSuffix}` : line
}

type StyleFormat = Parameters<typeof styleText>[0]

const LEVEL_STYLE: Record<LogLevel, StyleFormat> = {
  INFO: "green",
  WARN: "yellow",
  ERROR: ["red", "bold"],
}

/**
 * Render a record with ANSI colors for terminals. `styleText` degrades to
 * plain text when the stream is not a TTY or NO_COLOR is set, so this is safe
 * to use unconditionally for console output.
 */
export function formatPrettyRecord(
  record: LogRecord,
  stream: NodeJS.WriteStream,
): string {
  const paint = (format: StyleFormat, text: string): string => {
    try {
      return styleText(format, text, { stream })
    } catch {
      return text
    }
  }

  const ts = paint("dim", record.timestamp.toISOString())
  const level = paint(LEVEL_STYLE[record.level], record.level.padEnd(5))
  const scope = record.scope ? ` ${paint("cyan", `[${record.scope}]`)}` : ""
  const contextSuffix = sortedContextEntries(record.context)
    .map(([key, value]) => paint("dim", `${key}=${formatContextValue(value)}`))
    .join(" ")
  const line = `${ts} ${level}${scope} ${record.message}`
  return contextSuffix ? `${line} ${contextSuffix}` : line
}

const consoleSink: LogSink = {
  write(record) {
    const stream = record.level === "INFO" ? process.stdout : process.stderr
    const line =
      logFormat === "json"
        ? formatRecord(record, "json")
        : formatPrettyRecord(record, stream)
    stream.write(`${line}\n`)
  },
}

const sinks = new Set<LogSink>([consoleSink])

/**
 * Register an additional destination for every log record (e.g. a file in the
 * desktop app). Returns a function that removes the sink again.
 */
export function addLogSink(sink: LogSink): () => void {
  sinks.add(sink)
  return () => {
    sinks.delete(sink)
  }
}

function emit(level: LogLevel, scope: string | undefined, args: unknown[]) {
  const record: LogRecord = {
    timestamp: new Date(),
    level,
    scope,
    message: args.map(formatLogArg).join(" "),
    context: getLogContext(),
  }
  for (const sink of sinks) {
    try {
      sink.write(record)
    } catch {
      // Logging must not make the primary operation fail.
    }
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
