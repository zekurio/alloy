import { user } from "@alloy/db/auth-schema"
import { clip } from "@alloy/db/schema"
import { getSession } from "@alloy/server/auth/session"
import {
  denied,
  evaluateClipAccess,
  type ClipAccessDenied,
  type ClipAccessPolicyName,
  type ClipViewer,
} from "@alloy/server/clips/access-policy"
import { db } from "@alloy/server/db/index"
import { errorResult } from "@alloy/server/runtime/http-response"
import { eq } from "drizzle-orm"
import type { Context } from "hono"

type ClipAccessAllowed = {
  accessible: true
  row: typeof clip.$inferSelect
  viewer: ClipViewer
  isOwner: boolean
  isAdmin: boolean
}

type ClipAccessResult = ClipAccessAllowed | ClipAccessDenied

async function peekClipViewer(c: Context): Promise<ClipViewer> {
  const session = await getSession(c)
  if (!session) return null
  return {
    id: session.user.id,
    role: session.user.role,
  }
}

export async function resolveClipAccess({
  id,
  c,
  policy,
}: {
  id: string
  c: Context
  policy: ClipAccessPolicyName
}): Promise<ClipAccessResult> {
  const [selected] = await db
    .select({
      row: clip,
      authorDisabledAt: user.disabled_at,
    })
    .from(clip)
    .innerJoin(user, eq(clip.author_id, user.id))
    .where(eq(clip.id, id))
    .limit(1)

  if (!selected) {
    return denied("Not found", 404)
  }

  const { row, authorDisabledAt } = selected
  const viewer = await peekClipViewer(c)
  const decision = evaluateClipAccess({
    authorDisabledAt,
    authorId: row.author_id,
    policy,
    privacy: row.privacy,
    status: row.status,
    viewer,
  })

  if (!decision.accessible) {
    return decision
  }

  return {
    accessible: true,
    row,
    viewer,
    isOwner: decision.isOwner,
    isAdmin: decision.isAdmin,
  }
}

export function clipAccessResponse(c: Context, access: ClipAccessDenied) {
  return errorResult(c, access)
}
