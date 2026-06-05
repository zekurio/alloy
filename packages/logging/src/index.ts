import { inspect } from "node:util"

type LogWriter = Pick<NodeJS.WriteStream, "write">

export interface Logger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

function formatLogArg(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`
  }
  return inspect(value, { colors: false, depth: 6 })
}

function writeLogLine(writer: LogWriter, args: unknown[]): void {
  try {
    writer.write(`${args.map(formatLogArg).join(" ")}\n`)
  } catch {
    // Logging must not make the primary operation fail.
  }
}

export const logger: Logger = {
  info(...args) {
    writeLogLine(process.stdout, args)
  },
  warn(...args) {
    writeLogLine(process.stderr, args)
  },
  error(...args) {
    writeLogLine(process.stderr, args)
  },
}
