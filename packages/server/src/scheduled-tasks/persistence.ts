import { scheduledTaskRun } from "alloy-db/schema"
import { and, eq } from "drizzle-orm"

import { client, db } from "../db"
import type {
  ScheduledTaskPayload,
  ScheduledTaskResult,
  ScheduledTaskRunTrigger,
} from "./types"

export type ScheduledTaskRunStatus =
  | "running"
  | "success"
  | "failed"
  | "cancelled"

export type PersistedScheduledTaskRun = typeof scheduledTaskRun.$inferSelect

type RunRow = {
  id: string
  task_id: string
  trigger: ScheduledTaskRunTrigger
  status: ScheduledTaskRunStatus
  started_at: Date
  finished_at: Date | null
  duration_ms: number | null
  payload: ScheduledTaskPayload | null
  result: ScheduledTaskResult | null
  error: string | null
}

export async function createScheduledTaskRun(input: {
  id: string
  taskId: string
  trigger: ScheduledTaskRunTrigger
  payload: ScheduledTaskPayload | null
  startedAt: Date
}): Promise<PersistedScheduledTaskRun> {
  const [row] = await db
    .insert(scheduledTaskRun)
    .values({
      id: input.id,
      taskId: input.taskId,
      trigger: input.trigger,
      status: "running",
      startedAt: input.startedAt,
      payload: input.payload,
    })
    .returning()
  if (!row) throw new Error("Scheduled task run was not created")
  return row
}

export async function finishScheduledTaskRun(input: {
  id: string
  status: Exclude<ScheduledTaskRunStatus, "running">
  finishedAt: Date
  durationMs: number
  result: ScheduledTaskResult | null
  error: string | null
}): Promise<PersistedScheduledTaskRun | null> {
  const [row] = await db
    .update(scheduledTaskRun)
    .set({
      status: input.status,
      finishedAt: input.finishedAt,
      durationMs: input.durationMs,
      result: input.result,
      error: input.error,
    })
    .where(
      and(
        eq(scheduledTaskRun.id, input.id),
        eq(scheduledTaskRun.status, "running"),
      ),
    )
    .returning()
  return row ?? null
}

export async function latestScheduledTaskRuns(
  taskIds: string[],
): Promise<Map<string, PersistedScheduledTaskRun>> {
  if (taskIds.length === 0) return new Map()
  const result = await client.query<RunRow>(
    `
      select distinct on (task_id)
        id,
        task_id,
        trigger,
        status,
        started_at,
        finished_at,
        duration_ms,
        payload,
        result,
        error
      from scheduled_task_run
      where task_id = any($1::text[])
      order by task_id, started_at desc, id desc
    `,
    [taskIds],
  )

  return new Map(
    result.rows.map((row) => [
      row.task_id,
      {
        id: row.id,
        taskId: row.task_id,
        trigger: row.trigger,
        status: row.status,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        durationMs: row.duration_ms,
        payload: row.payload,
        result: row.result,
        error: row.error,
      },
    ]),
  )
}

export async function acquireScheduledTaskLock(input: {
  taskId: string
  ownerId: string
  runId: string
  ttlMs: number
}): Promise<boolean> {
  const result = await client.query(
    `
      insert into scheduled_task_lock (
        task_id,
        owner_id,
        run_id,
        heartbeat_at,
        locked_until,
        created_at,
        updated_at
      )
      values (
        $1,
        $2,
        $3,
        now(),
        now() + $4::double precision * interval '1 millisecond',
        now(),
        now()
      )
      on conflict (task_id) do update
        set owner_id = excluded.owner_id,
            run_id = excluded.run_id,
            heartbeat_at = excluded.heartbeat_at,
            locked_until = excluded.locked_until,
            updated_at = excluded.updated_at
        where scheduled_task_lock.locked_until <= now()
      returning task_id
    `,
    [input.taskId, input.ownerId, input.runId, input.ttlMs],
  )
  return (result.rowCount ?? 0) > 0
}

export async function heartbeatScheduledTaskLock(input: {
  taskId: string
  ownerId: string
  runId: string
  ttlMs: number
}): Promise<boolean> {
  const result = await client.query(
    `
      update scheduled_task_lock
      set heartbeat_at = now(),
          locked_until = now() + $4::double precision * interval '1 millisecond',
          updated_at = now()
      where task_id = $1
        and owner_id = $2
        and run_id = $3
      returning task_id
    `,
    [input.taskId, input.ownerId, input.runId, input.ttlMs],
  )
  return (result.rowCount ?? 0) > 0
}

export async function releaseScheduledTaskLock(input: {
  taskId: string
  ownerId: string
  runId: string
}): Promise<void> {
  await client.query(
    `
      delete from scheduled_task_lock
      where task_id = $1
        and owner_id = $2
        and run_id = $3
    `,
    [input.taskId, input.ownerId, input.runId],
  )
}

export async function cancelExpiredScheduledTaskRuns(): Promise<void> {
  await client.query(`
    update scheduled_task_run run
    set status = 'cancelled',
        finished_at = now(),
        duration_ms = greatest(
          0,
          floor(extract(epoch from (now() - run.started_at)) * 1000)
        )::integer,
        error = 'Scheduled task lock expired before the run completed.'
    where run.status = 'running'
      and not exists (
        select 1
        from scheduled_task_lock task_lock
        where task_lock.run_id = run.id
          and task_lock.locked_until > now()
      )
  `)
}
