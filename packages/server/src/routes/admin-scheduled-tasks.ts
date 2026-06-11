import { Hono, type Context } from "hono"
import { z } from "zod"

import { ScheduledTaskTriggersSchema } from "../config/schema"
import { badRequest, notFound } from "../runtime/http-response"
import {
  scheduledTaskInfoById,
  scheduledTaskInfos,
  type ScheduledTaskPayload,
  triggerScheduledTask,
  updateScheduledTaskTriggers,
} from "../scheduled-tasks"
import { zValidator } from "./validation"

const ScheduledTaskParam = z.object({
  id: z.string().min(1).max(128),
})

const ScheduledTaskTriggersUpdate = z.object({
  triggers: ScheduledTaskTriggersSchema,
})

const ScheduledTaskRunBody = z.object({
  payload: z.record(z.string(), z.unknown()).optional(),
})

export const adminScheduledTasksRoute = new Hono()
  .get("/", async (c) => {
    return c.json({ tasks: await scheduledTaskInfos() })
  })
  .get("/:id", zValidator("param", ScheduledTaskParam), async (c) => {
    const { id } = c.req.valid("param")
    const task = await scheduledTaskInfoById(id)
    if (!task) return notFound(c, "Unknown scheduled task")
    return c.json(task)
  })
  .post("/:id/run", zValidator("param", ScheduledTaskParam), async (c) => {
    const { id } = c.req.valid("param")
    const payload = await readScheduledTaskPayload(c)
    if ("response" in payload) return payload.response
    const result = await triggerScheduledTask(id, payload.payload)
    if (!result) return notFound(c, "Unknown scheduled task")
    return c.json(result, result.started ? 202 : 200)
  })
  .put(
    "/:id/triggers",
    zValidator("param", ScheduledTaskParam),
    zValidator("json", ScheduledTaskTriggersUpdate),
    async (c) => {
      const { id } = c.req.valid("param")
      const { triggers } = c.req.valid("json")
      const task = await updateScheduledTaskTriggers(id, triggers)
      if (!task) return notFound(c, "Unknown scheduled task")
      return c.json(task)
    },
  )

async function readScheduledTaskPayload(
  c: Context,
): Promise<{ payload: ScheduledTaskPayload | null } | { response: Response }> {
  const contentType = c.req.header("content-type")
  if (!contentType?.toLowerCase().includes("application/json")) {
    return { payload: null }
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return { response: badRequest(c, "Invalid JSON.") }
  }

  const parsed = ScheduledTaskRunBody.safeParse(body ?? {})
  if (!parsed.success) {
    return { response: badRequest(c, "Invalid scheduled task payload.") }
  }
  return { payload: parsed.data.payload ?? null }
}
