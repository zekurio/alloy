import { t } from "@alloy/contracts/schema"
import { user } from "@alloy/db/auth-schema"
import { block, clip } from "@alloy/db/schema"
import { createZipStream } from "@alloy/server/archive/zip-stream"
import { clearSessionCookies } from "@alloy/server/auth/cookies"
import {
  disableUserIdentity,
  reactivateSelfDisabledIdentity,
} from "@alloy/server/auth/identity"
import {
  deleteAllSessionsForUser,
  getSession,
  requireAnySession,
  requireSession,
} from "@alloy/server/auth/session"
import { deleteClipRowAndAssets } from "@alloy/server/clips/delete"
import { db } from "@alloy/server/db/index"
import { isoDate, nullableIsoDate } from "@alloy/server/runtime/date"
import {
  accountState,
  badRequest,
  batchProgress,
  booleanFlag,
  forbidden,
} from "@alloy/server/runtime/http-response"
import { pipeReadable } from "@alloy/server/runtime/streaming"
import { clipStorage } from "@alloy/server/storage/index"
import { selectSourceStorageUsedBytes } from "@alloy/server/storage/quota"
import { accountDeletionState } from "@alloy/server/users/account-deletion-state"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { stream } from "hono/streaming"

import { contentDisposition, downloadFilename } from "./clips-helpers"
import {
  listTaggedClips,
  listUserClips,
  listUserGames,
  UserGamesQuery,
  UserMediaQuery,
} from "./users-clip-listings"
import {
  loadUserTarget,
  resolveViewerState,
  SearchQuery,
  searchVisibleUsers,
  selectProfileCounts,
  toPublicUser,
  UsernameParam,
} from "./users-helpers"
import { limitQueryParam, tbValidator } from "./validation"

const ClipBatchQuery = t.object({
  limit: limitQueryParam(100, 100),
})

export const usersRoute = new Hono()
  .get(
    "/:username/media",
    tbValidator("param", UsernameParam),
    tbValidator("query", UserMediaQuery),
    loadUserTarget,
    async (c) => {
      const options = c.req.valid("query")
      const list = options.tab === "tagged" ? listTaggedClips : listUserClips
      return c.json(await list(c.var.target, c, options))
    },
  )
  .get("/search", tbValidator("query", SearchQuery), async (c) => {
    const { q, limit } = c.req.valid("query")
    const session = await getSession(c)
    const rows = await searchVisibleUsers({
      q,
      limit,
      viewerId: session?.user.status === "active" ? session.user.id : null,
    })
    return c.json(rows)
  })
  .get("/me/account", requireSession, async (c) => {
    const [row] = await db
      .select({ disabledAt: user.disabled_at })
      .from(user)
      .where(eq(user.id, c.var.viewerId))
      .limit(1)
    return accountState(c, nullableIsoDate(row?.disabledAt ?? null))
  })
  .get("/me/storage", requireSession, async (c) => {
    return c.json({
      usedBytes: await selectSourceStorageUsedBytes(db, c.var.viewerId),
      quotaBytes: c.var.session.user.storage_quota_bytes,
    })
  })
  .post("/me/disable", requireSession, async (c) => {
    const viewerId = c.var.viewerId
    const disabled = await disableUserIdentity(viewerId, "self")
    const disabledAt = disabled?.disabledAt ?? new Date()
    await deleteAllSessionsForUser(viewerId)
    clearSessionCookies(c)
    return accountState(c, isoDate(disabledAt))
  })
  .post("/me/reactivate", requireAnySession, async (c) => {
    const reactivated = await accountDeletionState.withInactive(
      c.var.viewerId,
      () => reactivateSelfDisabledIdentity(c.var.viewerId),
    )
    if (!reactivated.ok) {
      return badRequest(c, "Account deletion is in progress.")
    }
    if (reactivated.value !== "reactivated") {
      return forbidden(c, "An administrator must reactivate this account.")
    }
    return accountState(c, null)
  })
  .get("/me/clips/download", requireSession, async (c) => {
    const rows = await db
      .select()
      .from(clip)
      .where(eq(clip.author_id, c.var.viewerId))
      .orderBy(clip.created_at)

    const entries = rows.map((row) => ({
      filename: downloadFilename(row),
      stream: async () => {
        if (!row.source_key) return null
        const resolved = await clipStorage.resolve(row.source_key)
        return resolved?.stream() ?? null
      },
    }))

    c.header("Content-Type", "application/zip")
    c.header(
      "Content-Disposition",
      contentDisposition(
        `alloy-clips-${new Date().toISOString().slice(0, 10)}.zip`,
      ),
    )
    c.header("Cache-Control", "no-store")

    const zip = createZipStream(entries)
    return stream(c, async (s) => {
      await pipeReadable(s, zip)
    })
  })
  .delete(
    "/me/clips",
    requireSession,
    tbValidator("query", ClipBatchQuery),
    async (c) => {
      const { limit } = c.req.valid("query")
      const rows = await db
        .select()
        .from(clip)
        .where(eq(clip.author_id, c.var.viewerId))
        .orderBy(clip.created_at)
        .limit(limit + 1)
      const batch = rows.slice(0, limit)

      for (const row of batch) {
        await deleteClipRowAndAssets(row)
      }

      return batchProgress(c, "deleted", batch.length, rows.length > limit)
    },
  )
  .get(
    "/:username",
    tbValidator("param", UsernameParam),
    loadUserTarget,
    async (c) => {
      const row = c.var.target
      const counts = await selectProfileCounts(row.id, {
        includeRestrictedClips: false,
      })

      return c.json({
        user: toPublicUser(row),
        counts,
      })
    },
  )
  .get(
    "/:username/viewer",
    tbValidator("param", UsernameParam),
    loadUserTarget,
    async (c) => {
      const row = c.var.target
      const session = await getSession(c)
      if (!session || session.user.status !== "active") {
        return c.json({ viewer: null, counts: null })
      }

      const viewerId = session.user.id
      const isAdmin = session.user.role === "admin"
      const isSelf = viewerId === row.id
      const [viewer, counts] = await Promise.all([
        resolveViewerState(viewerId, row.id),
        isSelf || isAdmin
          ? selectProfileCounts(row.id, { includeRestrictedClips: true })
          : Promise.resolve(null),
      ])

      return c.json({
        viewer,
        counts,
      })
    },
  )
  .get(
    "/:username/clips",
    tbValidator("param", UsernameParam),
    loadUserTarget,
    async (c) => c.json(await listUserClips(c.var.target, c)),
  )
  .get(
    "/:username/games",
    tbValidator("param", UsernameParam),
    tbValidator("query", UserGamesQuery),
    loadUserTarget,
    async (c) =>
      c.json(await listUserGames(c.var.target, c, c.req.valid("query"))),
  )
  .get(
    "/:username/tagged",
    tbValidator("param", UsernameParam),
    loadUserTarget,
    async (c) => c.json(await listTaggedClips(c.var.target, c)),
  )
  .post(
    "/:username/block",
    requireSession,
    tbValidator("param", UsernameParam),
    loadUserTarget,
    async (c) => {
      const viewerId = c.var.viewerId
      const target = c.var.target
      if (viewerId === target.id) {
        return badRequest(c, "You can't block yourself.")
      }

      await db
        .insert(block)
        .values({
          id: crypto.randomUUID(),
          blocker_id: viewerId,
          blocked_id: target.id,
        })
        .onConflictDoNothing()

      return booleanFlag(c, "blocked", true)
    },
  )
  .delete(
    "/:username/block",
    requireSession,
    tbValidator("param", UsernameParam),
    loadUserTarget,
    async (c) => {
      await db
        .delete(block)
        .where(
          and(
            eq(block.blocker_id, c.var.viewerId),
            eq(block.blocked_id, c.var.target.id),
          ),
        )
      return booleanFlag(c, "blocked", false)
    },
  )
