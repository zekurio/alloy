import { clientLogger } from "./client-log"

/**
 * Runs the follow-up refetch after a write that already succeeded. Callers
 * apply the write's own result first, so the refetch only catches the rest of
 * the app up: its failure is logged and never turns a saved change into an
 * error. The returned promise never rejects, so callers can fire and forget.
 */
export async function refreshAfterWrite(
  scope: string,
  refresh: () => Promise<void>,
): Promise<void> {
  try {
    await refresh()
  } catch (cause) {
    clientLogger.warn(
      `[${scope}] Refresh after a successful save failed.`,
      cause,
    )
  }
}
