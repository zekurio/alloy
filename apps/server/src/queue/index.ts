import { PgBoss } from "pg-boss"

import { env } from "../env"
import { configStore } from "../lib/config-store"
import { ENCODE_JOB, registerEncodeWorker } from "./encode-worker"
import { REAP_JOB, registerReaperWorker } from "./reaper"

/**
 * pg-boss singleton. We only want one Boss per process — it spawns its
 * own pg pool, registers its own LISTEN, and races itself if it's started
 * twice. The `_boss` cache + `getBoss()` accessor mirror the `db`
 * singleton in `apps/server/src/db/index.ts`.
 *
 * Why pg-boss vs bullmq+redis: Postgres is the only required infra here.
 * Adding redis just for a queue would double the operational surface for
 * a feature that runs maybe one job per upload. pg-boss creates its own
 * `pgboss` schema in the same DB — we don't need to coordinate
 * migrations with it.
 */

let _boss: PgBoss | null = null

export function getBoss(): PgBoss {
  if (!_boss) {
    _boss = new PgBoss({
      connectionString: env.DATABASE_URL,
    })
    // pg-boss v12 moved retention onto per-queue policy (see
    // `queue/encode-worker.ts`'s `createQueue` call). We don't need
    // additional historical job rows for analytics, so the per-queue
    // defaults (a couple of weeks for completed jobs) suffice; the reaper
    // is responsible for orphan recovery on the `clip` table itself.
  }
  return _boss
}

/**
 * Boot the queue: start pg-boss, register workers, schedule the reaper.
 * Called from `apps/server/src/index.ts` after the HTTP server is up so
 * an early connection failure doesn't take the API down before it ever
 * answers `/health`.
 */
export async function startQueue(): Promise<void> {
  const boss = getBoss()
  // Surface boss's own errors at the process level — without this an
  // ECONNREFUSED on the boss pool dies silently inside its EventEmitter.
  boss.on("error", (err: Error) => {
    // eslint-disable-next-line no-console
    console.error("[queue] pg-boss error:", err)
  })
  await boss.start()
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
  if (!_boss) return
  await _boss.stop({ graceful: true })
  _boss = null
}

export { ENCODE_JOB } from "./encode-worker"
