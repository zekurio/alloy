import { user } from "@alloy/db/auth-schema"
import { clip } from "@alloy/db/schema"
import { getSession } from "@alloy/server/auth/session"
import {
  CLIP_ACCESS_POLICIES,
  denied,
  evaluateClipAccess,
  type ClipAccessDenied,
  type ClipAccessPolicyName,
  type ClipViewer,
} from "@alloy/server/clips/access-policy"
import { selectClipById } from "@alloy/server/clips/select"
import { db } from "@alloy/server/db/index"
import { requiredSql } from "@alloy/server/db/sql"
import { errorResult } from "@alloy/server/runtime/http-response"
import { and, eq, isNull, ne, or, type SQL, sql } from "drizzle-orm"
import type { Context } from "hono"

type ClipAccessAllowed = {
  accessible: true
  row: typeof clip.$inferSelect
  viewer: ClipViewer
  isOwner: boolean
  isAdmin: boolean
}

type ClipAccessResult = ClipAccessAllowed | ClipAccessDenied

/**
 * Apply the same clip policy while loading rows through a related resource.
 * The query must join the clip author as `user` before it uses this condition.
 */
export function clipAccessCondition(
  viewer: ClipViewer,
  policy: ClipAccessPolicyName,
): SQL {
  const readiness = CLIP_ACCESS_POLICIES[policy].readiness
  if (viewer?.role === "admin") {
    return readiness === "ready" ? eq(clip.status, "ready") : sql`true`
  }

  const owner = viewer ? eq(clip.author_id, viewer.id) : null
  const conditions: SQL[] = [
    owner
      ? requiredSql(
          or(isNull(user.disabled_at), owner),
          "clip author visibility",
        )
      : isNull(user.disabled_at),
    owner
      ? requiredSql(
          or(ne(clip.privacy, "private"), owner),
          "clip privacy visibility",
        )
      : ne(clip.privacy, "private"),
  ]
  if (readiness === "ready") {
    conditions.push(eq(clip.status, "ready"))
  } else if (owner) {
    conditions.push(
      requiredSql(or(eq(clip.status, "ready"), owner), "clip readiness"),
    )
  } else {
    conditions.push(eq(clip.status, "ready"))
  }
  return requiredSql(and(...conditions), "clip access")
}

async function peekClipViewer(c: Context): Promise<ClipViewer> {
  const session = await getSession(c)
  if (!session) return null
  return {
    id: session.user.id,
    role: session.user.role,
    status: session.user.status,
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

/**
 * Load a clip exactly as an anonymous visitor sees it, in the rich shape the
 * embed surfaces need. Shares evaluateClipAccess with resolveClipAccess so the
 * app shell, the Mastodon status document and the API cannot drift on who may
 * see what.
 */
export async function selectEmbeddableClip(id: string) {
  const row = await selectClipById(id)
  if (!row) return null

  const [author] = await db
    .select({ disabledAt: user.disabled_at })
    .from(user)
    .where(eq(user.id, row.authorId))
    .limit(1)

  const decision = evaluateClipAccess({
    authorDisabledAt: author?.disabledAt ?? null,
    authorId: row.authorId,
    policy: "embed",
    privacy: row.privacy,
    status: row.status,
    viewer: null,
  })
  return decision.accessible ? row : null
}
