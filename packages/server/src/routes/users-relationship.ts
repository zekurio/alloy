import { block } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import {
  badRequest,
  booleanFlag,
  notFound,
} from "@alloy/server/runtime/http-response"
import { and, eq } from "drizzle-orm"
import type { Context } from "hono"

import { resolveTarget, type UserRow } from "./users-helpers"

type UserTargetResult = { target: UserRow } | { response: Response }

export async function resolveUserTarget(
  c: Context,
  username: string,
): Promise<UserTargetResult> {
  const target = await resolveTarget(username)
  if (!target) return { response: notFound(c) }
  return { target }
}

export async function resolveRelationshipTarget(
  c: Context,
  input: {
    username: string
    viewerId: string
    selfError?: string
  },
): Promise<UserTargetResult> {
  const result = await resolveUserTarget(c, input.username)
  if ("response" in result) return result
  const target = result.target

  if (input.selfError && input.viewerId === target.id) {
    return { response: badRequest(c, input.selfError) }
  }

  return { target }
}

export async function deleteViewerBlock(
  c: Context,
  username: string,
  viewerId: string,
) {
  const result = await resolveRelationshipTarget(c, { username, viewerId })
  if ("response" in result) return result.response

  await db
    .delete(block)
    .where(
      and(
        eq(block.blocker_id, viewerId),
        eq(block.blocked_id, result.target.id),
      ),
    )
  return booleanFlag(c, "blocked", false)
}
