import { createMiddleware } from "hono/factory"

import { getAuth } from "../auth"

export const requireSession = createMiddleware<{
  Variables: { viewerId: string }
}>(async (c, next) => {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  c.set("viewerId", session.user.id)
  await next()
})
