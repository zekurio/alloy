import type {
  AdminScheduledTaskPayload,
  AdminScheduledTaskResult,
} from "@alloy/contracts"
import { sql } from "drizzle-orm"
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { sqlStringList } from "./internal"

export const SCHEDULED_TASK_TRIGGERS = ["startup", "cron", "manual"] as const
export type ScheduledTaskTrigger = (typeof SCHEDULED_TASK_TRIGGERS)[number]

export const SCHEDULED_TASK_STATUSES = [
  "running",
  "success",
  "failed",
  "cancelled",
] as const
export type ScheduledTaskStatus = (typeof SCHEDULED_TASK_STATUSES)[number]

export const scheduledTaskRun = pgTable(
  "scheduled_task_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: text("task_id").notNull(),
    trigger: text("trigger").$type<ScheduledTaskTrigger>().notNull(),
    status: text("status").$type<ScheduledTaskStatus>().notNull(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
    durationMs: integer("duration_ms"),
    payload: jsonb("payload").$type<AdminScheduledTaskPayload | null>(),
    result: jsonb("result").$type<AdminScheduledTaskResult | null>(),
    error: text("error"),
  },
  (t) => [
    index("scheduled_task_run_task_started_idx").on(t.taskId, t.startedAt),
    index("scheduled_task_run_status_idx").on(t.status),
    check(
      "scheduled_task_run_trigger_check",
      sql`${t.trigger} in (${sql.raw(sqlStringList(SCHEDULED_TASK_TRIGGERS))})`,
    ),
    check(
      "scheduled_task_run_status_check",
      sql`${t.status} in (${sql.raw(sqlStringList(SCHEDULED_TASK_STATUSES))})`,
    ),
    check(
      "scheduled_task_run_duration_ms_check",
      sql`${t.durationMs} is null or ${t.durationMs} >= 0`,
    ),
  ],
)

export const scheduledTaskLock = pgTable("scheduled_task_lock", {
  taskId: text("task_id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  runId: uuid("run_id").notNull(),
  heartbeatAt: timestamp("heartbeat_at").notNull().defaultNow(),
  lockedUntil: timestamp("locked_until").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})
