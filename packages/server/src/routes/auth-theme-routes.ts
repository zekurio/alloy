import {
  MAX_USER_THEMES,
  SyncedThemePreferencesSchema,
  UserThemeIdSchema,
  UserThemeInputSchema,
} from "@alloy/contracts"
import { t } from "@alloy/contracts/schema"
import { updateUserThemePreferences } from "@alloy/server/auth/identity"
import { publicAuthUserRow } from "@alloy/server/auth/security-responses"
import { requireSession } from "@alloy/server/auth/session"
import {
  badRequestFromCause,
  conflict,
  success,
} from "@alloy/server/runtime/http-response"
import { rateLimiter } from "@alloy/server/runtime/rate-limit"
import {
  deleteUserTheme,
  listUserThemes,
  saveUserTheme,
} from "@alloy/server/users/user-themes"
import { Hono } from "hono"

import { tbValidator } from "./validation"

const UserThemeParam = t.object({ id: UserThemeIdSchema })

/**
 * Per user, since theme writes skip the auth routes' per-IP limit. Room for
 * clicking through the picker or importing a full set of themes at once.
 */
const themeWriteRateLimit = rateLimiter<{ Variables: { viewerId: string } }>({
  windowMs: 60_000,
  max: 120,
  key: (c) => c.var.viewerId,
})

/** The signed-in user's theme choice and their own color themes. */
export const authThemeRoutes = new Hono()
  .put(
    "/user/theme",
    requireSession,
    themeWriteRateLimit,
    tbValidator("json", SyncedThemePreferencesSchema),
    async (c) => {
      try {
        const updated = await updateUserThemePreferences(
          c.var.viewerId,
          c.req.valid("json"),
        )
        return c.json({ user: publicAuthUserRow(updated) })
      } catch (cause) {
        return badRequestFromCause(c, cause, "Could not save theme.")
      }
    },
  )
  .get("/user/themes", requireSession, async (c) => {
    return c.json({ themes: await listUserThemes(c.var.viewerId) })
  })
  .put(
    "/user/themes/:id",
    requireSession,
    themeWriteRateLimit,
    tbValidator("param", UserThemeParam),
    tbValidator("json", UserThemeInputSchema),
    async (c) => {
      const theme = await saveUserTheme(
        c.var.viewerId,
        c.req.valid("param").id,
        c.req.valid("json"),
      )
      if (!theme) {
        return conflict(c, `You can save up to ${MAX_USER_THEMES} themes.`)
      }
      return c.json({ theme })
    },
  )
  .delete(
    "/user/themes/:id",
    requireSession,
    themeWriteRateLimit,
    tbValidator("param", UserThemeParam),
    async (c) => {
      await deleteUserTheme(c.var.viewerId, c.req.valid("param").id)
      return success(c)
    },
  )
