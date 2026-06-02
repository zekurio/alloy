interface ClientLogger {
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

type ClientLogLevel = keyof ClientLogger

function write(level: ClientLogLevel, args: unknown[]): void {
  const sink = globalThis.console?.[level]
  if (!sink) return
  sink.apply(globalThis.console, args)
}

export const clientLogger: ClientLogger = {
  warn(...args) {
    write("warn", args)
  },
  error(...args) {
    write("error", args)
  },
}
