import { format } from "node:util"

import type { LogLevel, NativeAddon } from "./native"

// Shell diagnostics go to the host log the native code writes, so one file
// holds both. Until the log is open they only reach stderr.

let sink: NativeAddon | null = null

export function attachLogSink(addon: NativeAddon): void {
  sink = addon
}

/** An error's message followed by its causes, as the native log writes them. */
function describe(error: Error): string {
  let text = error.message
  let cause = error.cause
  while (cause instanceof Error) {
    text += `: ${cause.message}`
    cause = cause.cause
  }
  return text
}

function write(
  level: LogLevel,
  message: string,
  values: readonly Error[],
): void {
  const line =
    values.length > 0 ? format(message, ...values.map(describe)) : message
  if (sink) sink.log(level, line)
  else process.stderr.write(`${level.toUpperCase()} ${line}\n`)
}

export const log = {
  info: (message: string) => write("info", message, []),
  warn: (message: string, ...causes: Error[]) => write("warn", message, causes),
  error: (message: string, ...causes: Error[]) =>
    write("error", message, causes),
}

/** For `.catch`: logs the cause and rejects with the fixed message instead. */
export function logged(message: string): (cause: Error) => never {
  return (cause) => {
    log.warn(`${message} %s`, cause)
    throw new Error(message)
  }
}

/** An `Error` for anything a promise rejected or a callback threw with. */
export function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}
