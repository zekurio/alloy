import { PgBoss } from "pg-boss"

import { env } from "../env"
import { configStore } from "../lib/config-store"
import { ENCODE_JOB, registerEncodeWorker } from "./encode-worker"
import { REAP_JOB, registerReaperWorker } from "./reaper"

/**
 * pg-boss singleton. We only want one Boss per process — it spawns its
 * own pg pool, registers its own LISTEN, and races itself if it's started
 * twice. The `_bossPromise` cache + `getBoss()` accessor mirror the `db`
 * singleton in `apps/server/src/db/index.ts`, but returns a promise so
 * callers never see a half-constructed boss.
 *
 * Why a promise: pg-boss's `.send()` asserts the queue cache exists,
 * which is only populated inside `boss.start()`. If the HTTP server
 * starts accepting traffic before `start()` resolves (we deliberately
 * want that so `/health` stays up during a DB blip), a request that
 * dispatches a job would hit a bare assertion error. Caching the start
 * promise means the first caller kicks off startup and everyone else
 * awaits the same promise — a genuine failure propagates as a real
 * error to the HTTP handler instead of crashing into an assert.
 *
 * Why pg-boss vs bullmq+redis: Postgres is the only required infra here.
 * Adding redis just for a queue would double the operational surface for
 * a feature that runs maybe one job per upload. pg-boss creates its own
 * `pgboss` schema in the same DB — we don't need to coordinate
 * migrations with it.
 */

let _bossPromise: Promise<PgBoss> | null = null

export function getBoss(): Promise<PgBoss> {
  if (!_bossPromise) {
    const boss = new PgBoss({
      connectionString: env.DATABASE_URL,
    })
    // Surface boss's own errors at the process level — without this an
    // ECONNREFUSED on the boss pool dies silently inside its EventEmitter.
    // Attach before start() so any error emitted during connect lands
    // here instead of an unhandled 'error' event on the EventEmitter.
    boss.on("error", (err: Error) => {
      // eslint-disable-next-line no-console
      console.error("[queue] pg-boss error:", err)
    })
    // pg-boss v12 moved retention onto per-queue policy (see
    // `queue/encode-worker.ts`'s `createQueue` call). We don't need
    // additional historical job rows for analytics, so the per-queue
    // defaults (a couple of weeks for completed jobs) suffice; the reaper
    // is responsible for orphan recovery on the `clip` table itself.
    _bossPromise = boss.start().then(() => boss)
    // If start() rejects we want the next getBoss() call to retry
    // instead of sticking with a dead promise forever.
    _bossPromise.catch(() => {
      _bossPromise = null
    })
  }
  return _bossPromise
}

/**
 * Boot the queue: start pg-boss, register workers, schedule the reaper.
 * Called from `apps/server/src/index.ts` after the HTTP server is up so
 * an early connection failure doesn't take the API down before it ever
 * answers `/health`.
 */
export async function startQueue(): Promise<void> {
  const boss = await getBoss()
  await registerEncodeWorker(boss)
  await registerReaperWorker(boss)
  // eslint-disable-next-line no-console
  console.log(
    `→ queue ready (jobs: ${ENCODE_JOB}, ${REAP_JOB}; concurrency: ${configStore.get("limits").queueConcurrency})`
  )
}

/**
 * Drain in-flight handlers and disconnect. Wait for this from the
 * `SIGINT`/`SIGTERM` shutdown path — leaving an encode mid-stream means
 * the next start will see a `pending` job and re-pick it via pg-boss's
 * own re-attempt logic.
 */
export async function stopQueue(): Promise<void> {
  if (!_bossPromise) return
  // Await the cached start() before stopping — if shutdown races a
  // still-pending start we'd otherwise leave a half-initialised boss
  // behind. If start() ultimately rejected, swallow it: there's nothing
  // to stop.
  const boss = await _bossPromise.catch(() => null)
  _bossPromise = null
  if (boss) {
    await boss.stop({ graceful: true })
  }
}

export { ENCODE_JOB } from "./encode-worker"
