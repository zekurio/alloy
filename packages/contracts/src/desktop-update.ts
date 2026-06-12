/**
 * Auto-update state the desktop shell exposes to the web app over the
 * desktop bridge, so the in-app notification center can surface a
 * device-local "update ready" entry. This never goes through the server —
 * an update is specific to the machine running the desktop app.
 */
export type DesktopUpdateStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "downloaded"

export interface DesktopUpdateState {
  status: DesktopUpdateStatus
  /** Version of the pending update once one is known, e.g. "0.2.0". */
  version: string | null
}
