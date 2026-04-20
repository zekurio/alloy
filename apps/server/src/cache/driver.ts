/**
 * Generic cache driver. The in-memory implementation lives next door
 * (`memory.ts`) and is the only one that exists today; a `redis` driver
 * drops in here without touching call sites — the `/view` handler (and
 * any future dedup-style caller) only ever imports the `cache` singleton
 * and leans on this interface.
 *
 * The shape is deliberately tiny. One operation — `setIfAbsent` — because
 * that's the only primitive the current caller (view dedup inside a 24h
 * window) needs. When another caller arrives (rate limiting, idempotent
 * webhooks, etc.) we extend the interface and implement both sides; we
 * don't speculate now.
 */
export interface Cache {
  /**
   * Atomically set a key with a TTL if and only if it's currently absent.
   * Returns `true` on a fresh write, `false` when the key was already
   * present within its TTL.
   *
   * This is the dedup primitive: callers use it to answer "is this the
   * first event for this key inside the window?" without caring whether
   * the backing store is a local Map or a Redis `SET NX EX`.
   *
   * Errors (driver reachability, etc.) propagate — the view handler
   * treats a thrown error as "don't count, log and move on" so a dead
   * cache never takes the API down.
   */
  setIfAbsent(key: string, ttlSec: number): Promise<boolean>
}
