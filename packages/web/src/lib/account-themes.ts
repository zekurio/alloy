import {
  deleteCustomTheme,
  saveCustomTheme,
  setCustomThemes,
} from "@alloy/ui/lib/theme"
import {
  accountThemeInput,
  customThemeFromAccount,
  type CustomTheme,
} from "@alloy/ui/lib/theme-custom"

import { authClient } from "./auth-client"
import { clientLogger } from "./client-log"

/**
 * Custom themes belong to the account. The theme engine keeps the browser's
 * copy, which changes only once the server has the change, so a failed save
 * never looks saved.
 */

// Moves on before and after every change made here: a list read that overlaps
// one may predate it and would bring back a deleted theme or undo an edit.
let revision = 0

export async function loadAccountThemes(): Promise<void> {
  const started = revision
  const { data, error } = await authClient.listThemes()
  if (!data) {
    clientLogger.warn("[theme] Couldn't load custom themes.", error)
    return
  }
  if (started !== revision) return
  setCustomThemes(data.themes.map(customThemeFromAccount))
}

/** Saves a new or edited theme, then shows it. Throws when the save fails. */
export async function saveAccountTheme(
  theme: CustomTheme,
): Promise<CustomTheme> {
  revision += 1
  try {
    const { data, error } = await authClient.saveTheme(
      theme.id,
      accountThemeInput(theme),
    )
    if (!data) throw new Error(error?.message ?? "Could not save theme")
    const saved = customThemeFromAccount(data.theme)
    saveCustomTheme(saved)
    return saved
  } finally {
    revision += 1
  }
}

/** Deletes the theme; modes that used it go back to Alloy. */
export async function deleteAccountTheme(id: string): Promise<void> {
  revision += 1
  try {
    const { error } = await authClient.deleteTheme(id)
    if (error) throw new Error(error.message)
    deleteCustomTheme(id)
  } finally {
    revision += 1
  }
}
