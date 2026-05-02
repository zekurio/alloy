import { Hono } from "hono"
import { and, eq, inArray, isNull } from "drizzle-orm"

import type { PublicAuthConfig } from "@workspace/contracts"
import { user } from "@workspace/db/auth-schema"
import { clip } from "@workspace/db/schema"

import { db } from "../db"
import { configStore } from "../config/store"
import { getPublicProvider } from "../auth/oauth-config"
import { getSetupStatus } from "../auth/user-bootstrap"

export const authConfigRoute = new Hono().get("/", async (c) => {
  const setupStatus = await getSetupStatus()
  const loginSplash = configStore.get("appearance").loginSplash
  const splashRows =
    loginSplash.enabled && loginSplash.clipIds.length > 0
      ? await db
          .select({
            id: clip.id,
            title: clip.title,
            game: clip.game,
          })
          .from(clip)
          .innerJoin(user, eq(clip.authorId, user.id))
          .where(
            and(
              inArray(clip.id, loginSplash.clipIds),
              eq(clip.status, "ready"),
              eq(clip.privacy, "public"),
              isNull(user.disabledAt)
            )
          )
      : []
  const splashById = new Map(splashRows.map((row) => [row.id, row]))
  return c.json({
    ...setupStatus,
    openRegistrations: configStore.get("openRegistrations"),
    passkeyEnabled: configStore.get("passkeyEnabled"),
    requireAuthToBrowse: configStore.get("requireAuthToBrowse"),
    provider: getPublicProvider(),
    loginSplash: {
      enabled: loginSplash.enabled,
      generatedAt: loginSplash.generatedAt,
      clips: loginSplash.clipIds.flatMap((id) => {
        const row = splashById.get(id)
        return row ? [row] : []
      }),
    },
  } satisfies PublicAuthConfig)
})
