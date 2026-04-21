import { PgBoss } from "pg-boss"

import { env } from "../env"
import { registerEncodeWorker } from "./encode-worker"
import { registerReaperWorker } from "./reaper"

let _bossPromise: Promise<PgBoss> | null = null

export function getBoss(): Promise<PgBoss> {
  if (!_bossPromise) {
    const boss = new PgBoss({
      connectionString: env.DATABASE_URL,
    })
    boss.on("error", (err: Error) => {
      // eslint-disable-next-line no-console
      console.error("[queue] pg-boss error:", err)
    })
    _bossPromise = boss.start().then(() => boss)
    // If start() rejects we want the next getBoss() call to retry
    // instead of sticking with a dead promise forever.
    _bossPromise.catch(() => {
      _bossPromise = null
    })
  }
  return _bossPromise
}

export async function startQueue(): Promise<void> {
  const boss = await getBoss()
  await registerEncodeWorker(boss)
  await registerReaperWorker(boss)
  // eslint-disable-next-line no-console
}

export async function stopQueue(): Promise<void> {
  if (!_bossPromise) return
  const boss = await _bossPromise.catch(() => null)
  _bossPromise = null
  if (boss) {
    await boss.stop({ graceful: true })
  }
}

export { ENCODE_JOB } from "./encode-worker"
