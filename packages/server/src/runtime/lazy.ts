import { t } from "@alloy/contracts/schema"

const LazyMethodSchema = t.instanceof(Function)

/**
 * Defers construction to first property access while keeping the value's
 * shape, so `import { db }` stays a no-op until something actually reads it.
 *
 * This exists because importing a module should not have side effects. Env
 * parsing, connection pools and storage roots used to be built at module load,
 * which meant importing any of the 80-odd modules that touch the database
 * opened a Postgres pool - forcing tests to dynamically import everything after
 * pointing env at a scratch database, and forcing CI to invent import-safe env
 * values for suites that never talk to a database.
 *
 * Startup still fails fast: `src/index.ts` reads env on its first line, so a
 * misconfigured deploy dies at boot rather than mid-request.
 */
export function lazy<T extends object>(create: () => T): T {
  let instance: T | undefined
  const resolve = () => (instance ??= create())
  // SAFETY: The proxy exposes the same property contract as the resolved T.
  return new Proxy({} as T, {
    get(_target, property) {
      const resolved = resolve()
      // SAFETY: Proxy property keys are valid dynamic keys for the wrapped T.
      const value = resolved[property as keyof T]
      // Bound so class methods keep their real receiver; calling them with the
      // proxy as `this` would break any implementation using private fields.
      const method = LazyMethodSchema.safeParse(value)
      return method.success ? method.data.bind(resolved) : value
    },
    set(_target, property, value) {
      return Reflect.set(resolve(), property, value)
    },
    has: (_target, property) => Reflect.has(resolve(), property),
    ownKeys: () => Reflect.ownKeys(resolve()),
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), property)
      // The proxy's own target is an empty object, so a non-configurable
      // descriptor here would violate the invariant checks.
      return descriptor && { ...descriptor, configurable: true }
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(resolve()),
  })
}
