import { createMiddleware } from "hono/factory"

import { getAuth } from "../auth"

/**
 * Hono middleware: refuses requests without a valid better-auth session
 * and exposes the session's user id as `c.var.viewerId`. Routes that
 * need viewer-relative behaviour reach for `c.var.viewerId` directly
 * after this middleware has run.
 *
 * Lives in `lib/` rather than under any one route file because it's
 * shared between `routes/users.ts` and `routes/clips.ts` (and future
 * authenticated endpoints). Keep the side effects minimal — anything
 * non-trivial (loading the user row, checking ban status, etc.) belongs
 * downstream so the middleware stays cheap and the auth surface stays
 * small enough to grep.
 */
export const requireSession = createMiddleware<{
  Variables: { viewerId: string }
}>(async (c, next) => {
  const session = await getAuth().api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: "Unauthorized" }, 401)
  c.set("viewerId", session.user.id)
  await next()
})
