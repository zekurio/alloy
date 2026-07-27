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
import { selectClipById } from "@alloy/server/clips/select"
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

/**
 * Load a clip exactly as an anonymous visitor sees it, in the rich shape the
 * embed surfaces need. Shares evaluateClipAccess with resolveClipAccess so the
 * app shell, the Mastodon status document and the API cannot drift on who may
 * see what.
 */
export async function selectEmbeddableClip(id: string) {
  const row = await selectClipById(id)
  if (!row) return null

  // The author columns the Mastodon account object needs ride along with the
  // disabled_at check rather than bloating clipSelectShape, which would leak
  // them into every public clip payload.
  const [author] = await db
    .select({
      disabledAt: user.disabled_at,
      banner: user.banner,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    })
    .from(user)
    .where(eq(user.id, row.authorId))
    .limit(1)
  if (!author) return null

  const decision = evaluateClipAccess({
    authorDisabledAt: author.disabledAt,
    authorId: row.authorId,
    policy: "embed",
    privacy: row.privacy,
    status: row.status,
    viewer: null,
  })
  return decision.accessible ? { ...row, author } : null
}
