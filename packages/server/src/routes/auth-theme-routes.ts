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
  badRequest,
  badRequestFromCause,
  conflict,
  success,
} from "@alloy/server/runtime/http-response"
import {
  deleteUserTheme,
  listUserThemes,
  saveUserTheme,
} from "@alloy/server/users/user-themes"
import { Hono } from "hono"

import { tbValidator } from "./validation"

const UserThemeParam = t.object({ id: UserThemeIdSchema })

/** The signed-in user's theme choice and their own color themes. */
export const authThemeRoutes = new Hono()
  .put(
    "/user/theme",
    requireSession,
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
    tbValidator("param", UserThemeParam),
    tbValidator("json", UserThemeInputSchema),
    async (c) => {
      const input = c.req.valid("json")
      if (!input.light && !input.dark) {
        return badRequest(c, "A theme needs light or dark colors.")
      }
      const theme = await saveUserTheme(
        c.var.viewerId,
        c.req.valid("param").id,
        input,
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
    tbValidator("param", UserThemeParam),
    async (c) => {
      await deleteUserTheme(c.var.viewerId, c.req.valid("param").id)
      return success(c)
    },
  )
