import { zValidator } from "@hono/zod-validator"
import { desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { getAuth } from "../auth"
import { db } from "../db"
import { clip } from "../db/schema"

const CreateClipInput = z.object({
  title: z.string().min(1).max(120),
  game: z.string().min(1).max(60).optional(),
})

const IdParam = z.object({ id: z.string().min(1) })

export const clips = new Hono()
  .get("/", async (c) => {
    const rows = await db
      .select()
      .from(clip)
      .orderBy(desc(clip.createdAt))
      .limit(50)
    return c.json(rows)
  })
  .get("/:id", zValidator("param", IdParam), async (c) => {
    const { id } = c.req.valid("param")
    const rows = await db.select().from(clip).where(eq(clip.id, id)).limit(1)
    const row = rows[0]
    if (!row) {
      return c.json({ error: "Not found" }, 404)
    }
    return c.json(row)
  })
  .post("/", zValidator("json", CreateClipInput), async (c) => {
    const session = await getAuth().api.getSession({
      headers: c.req.raw.headers,
    })
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401)
    }
    const body = c.req.valid("json")
    const [row] = await db
      .insert(clip)
      .values({
        id: crypto.randomUUID(),
        title: body.title,
        game: body.game,
        authorId: session.user.id,
      })
      .returning()
    return c.json(row, 201)
  })
