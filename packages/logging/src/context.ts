import { AsyncLocalStorage } from "node:async_hooks"

export type LogContext = Record<string, string>

const logContextStorage = new AsyncLocalStorage<Readonly<LogContext>>()

export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  return logContextStorage.run(
    Object.freeze({ ...logContextStorage.getStore(), ...ctx }),
    fn,
  )
}

export function getLogContext(): LogContext {
  return { ...logContextStorage.getStore() }
}
