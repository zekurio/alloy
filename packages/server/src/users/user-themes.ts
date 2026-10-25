import {
  MAX_USER_THEMES,
  UserThemeSchema,
  type UserTheme,
  type UserThemeInput,
} from "@alloy/contracts"
import { userTheme, type UserThemeRow } from "@alloy/db/schema"
import { db } from "@alloy/server/db/index"
import { and, asc, eq } from "drizzle-orm"

/** The user's themes, oldest first, so a new theme joins the end. */
export async function listUserThemes(userId: string): Promise<UserTheme[]> {
  const rows = await db
    .select()
    .from(userTheme)
    .where(eq(userTheme.user_id, userId))
    .orderBy(asc(userTheme.created_at), asc(userTheme.id))
  return rows.flatMap((row) => {
    const theme = publicUserTheme(row)
    return theme ? [theme] : []
  })
}

/**
 * Replaces the user's theme with this id, or adds it while they're under
 * {@link MAX_USER_THEMES}. Null means the limit stopped a new theme.
 */
export async function saveUserTheme(
  userId: string,
  id: string,
  input: UserThemeInput,
): Promise<UserTheme | null> {
  const values = {
    name: input.name,
    light: input.light,
    dark: input.dark,
    guided: input.guided,
  }
  const mine = and(eq(userTheme.user_id, userId), eq(userTheme.id, id))
  const [updated] = await db
    .update(userTheme)
    .set({ ...values, updated_at: new Date() })
    .where(mine)
    .returning()
  if (updated) return requirePublicUserTheme(updated)

  // Simultaneous first saves can each pass this check; the limit only bounds
  // storage, so going over by a theme or two is fine.
  const count = await db.$count(userTheme, eq(userTheme.user_id, userId))
  if (count >= MAX_USER_THEMES) return null
  const [inserted] = await db
    .insert(userTheme)
    .values({ user_id: userId, id, ...values })
    .onConflictDoUpdate({
      target: [userTheme.user_id, userTheme.id],
      set: { ...values, updated_at: new Date() },
    })
    .returning()
  if (!inserted) throw new Error("Could not save theme.")
  return requirePublicUserTheme(inserted)
}

/** Deleting a theme that's already gone, say from another device, is fine. */
export async function deleteUserTheme(
  userId: string,
  id: string,
): Promise<void> {
  await db
    .delete(userTheme)
    .where(and(eq(userTheme.user_id, userId), eq(userTheme.id, id)))
}

/**
 * The theme as clients read it. A row that no longer fits the contract (say,
 * after a role is renamed) is left out rather than failing the whole list.
 */
function publicUserTheme(row: UserThemeRow): UserTheme | null {
  const parsed = UserThemeSchema.safeParse({
    id: row.id,
    name: row.name,
    light: row.light,
    dark: row.dark,
    guided: row.guided,
  })
  return parsed.success ? parsed.data : null
}

function requirePublicUserTheme(row: UserThemeRow): UserTheme {
  const theme = publicUserTheme(row)
  if (!theme) throw new Error("Could not save theme.")
  return theme
}
