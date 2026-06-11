import { AsyncLocalStorage } from "node:async_hooks"

export type LogContext = Record<string, string>

const logContextStorage = new AsyncLocalStorage<Readonly<LogContext>>()

export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  const current = logContextStorage.getStore()
  return logContextStorage.run(Object.freeze({ ...current, ...ctx }), fn)
}

export function getLogContext(): LogContext {
  return { ...logContextStorage.getStore() }
}
