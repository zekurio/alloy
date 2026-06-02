type LogWriter = Pick<typeof Deno.stdout, "writeSync">

export interface Logger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

const encoder = new TextEncoder()

function formatLogArg(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`
  }
  return Deno.inspect(value, { colors: false, depth: 6 })
}

function writeLogLine(writer: LogWriter, args: unknown[]): void {
  try {
    writer.writeSync(encoder.encode(`${args.map(formatLogArg).join(" ")}\n`))
  } catch {
    // Logging must not make the primary operation fail.
  }
}

export const logger: Logger = {
  info(...args) {
    writeLogLine(Deno.stdout, args)
  },
  warn(...args) {
    writeLogLine(Deno.stderr, args)
  },
  error(...args) {
    writeLogLine(Deno.stderr, args)
  },
}
