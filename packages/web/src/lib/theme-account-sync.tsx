import {
  SyncedThemePreferencesSchema,
  type SyncedThemePreferences,
} from "@alloy/contracts"
import {
  applySyncedThemePreferences,
  getThemeState,
  subscribeThemeEdits,
  syncedThemePreferences,
} from "@alloy/ui/lib/theme"
import { useEffect } from "react"

import { authClient, useSession } from "./auth-client"
import { clientLogger } from "./client-log"

/** Coalesces bursts, such as dragging the accent picker, into one save. */
const SAVE_DELAY_MS = 800
/**
 * Another device's change arrives with the next session read; coming back to
 * the tab reads it again, at most this often.
 */
const REVALIDATE_INTERVAL_MS = 30_000

let saveTimer: number | undefined
let saving: Promise<void> | null = null
let queued: SyncedThemePreferences | null = null

function scheduleSave(synced: SyncedThemePreferences) {
  queued = synced
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined
    void flushSave()
  }, SAVE_DELAY_MS)
}

/** Saves the latest queued theme, one request at a time. */
async function flushSave(): Promise<void> {
  if (saving) await saving
  const next = queued
  queued = null
  // Ids stored by an older build may not fit the contract; keep them local.
  const parsed = next ? SyncedThemePreferencesSchema.safeParse(next) : null
  if (!parsed?.success) return
  saving = authClient
    .updateThemePreferences(parsed.data)
    .then(({ error }) => {
      if (error) clientLogger.warn("[theme] Couldn't save theme.", error)
    })
    .catch((cause) => clientLogger.warn("[theme] Couldn't save theme.", cause))
    .finally(() => {
      saving = null
    })
  await saving
}

function saveOutstanding(): boolean {
  return saveTimer !== undefined || saving !== null || queued !== null
}

/**
 * Shares the theme between the signed-in user's devices: edits made here are
 * saved to the account, and the account's theme is adopted when the session
 * loads. Devices with sync off (see the Appearance settings) do neither.
 */
export function ThemeAccountSync() {
  const { data, refetch } = useSession()
  const user = data?.user
  const userId = user?.id ?? null
  const saved = user?.themePreferences ?? null
  const savedKey = saved ? JSON.stringify(saved) : null

  useEffect(() => {
    if (!userId) return
    return subscribeThemeEdits(scheduleSave)
  }, [userId])

  useEffect(() => {
    // An edit still on its way would be undone by the older saved copy; the
    // save's response brings the session up to date afterwards.
    if (!userId || saveOutstanding()) return
    if (saved) {
      applySyncedThemePreferences(saved)
      return
    }
    // The account has no theme yet, so this device's becomes it.
    const { preferences } = getThemeState()
    if (preferences.sync) scheduleSave(syncedThemePreferences(preferences))
  }, [userId, savedKey])

  useEffect(() => {
    if (!userId) return
    let lastRead = Date.now()
    const revalidate = () => {
      if (document.visibilityState !== "visible") return
      if (Date.now() - lastRead < REVALIDATE_INTERVAL_MS) return
      lastRead = Date.now()
      void refetch().catch(() => {})
    }
    document.addEventListener("visibilitychange", revalidate)
    return () => document.removeEventListener("visibilitychange", revalidate)
  }, [userId, refetch])

  return null
}
