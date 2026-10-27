import type { DesktopAutostartState } from "@alloy/contracts/desktop-autostart"
import { app } from "electron"

/**
 * The login item passes this, and such a start stays in the tray with no
 * window.
 */
export const AUTOSTART_ARGUMENT = "--autostart"
/**
 * The registry value under `HKCU\...\CurrentVersion\Run`. The uninstaller
 * removes it by this name.
 */
const LOGIN_ITEM_NAME = "Alloy"

/**
 * Login items are registered for installed Windows builds. A development
 * build would register the bare Electron binary. Linux autostart comes with
 * its packages.
 */
function supported(): boolean {
  return app.isPackaged && process.platform === "win32"
}

/** Electron lists the Run entries that start this executable. */
function loginItem() {
  return app
    .getLoginItemSettings()
    .launchItems.find(
      (item) => item.name.toLowerCase() === LOGIN_ITEM_NAME.toLowerCase(),
    )
}

export function launchedAtLogin(argv: readonly string[]): boolean {
  return argv.includes(AUTOSTART_ARGUMENT)
}

export function getAutostartState(): DesktopAutostartState {
  if (!supported()) return { supported: false, enabled: false }
  // Matched by value name: Electron's `openAtLogin` compares the whole
  // command line, so a value whose quoting differs would read as off.
  // `enabled` reflects Task Manager's startup toggle.
  return { supported: true, enabled: loginItem()?.enabled === true }
}

export function setAutostartEnabled(enabled: boolean): DesktopAutostartState {
  if (!supported()) return { supported: false, enabled: false }
  app.setLoginItemSettings({
    openAtLogin: enabled,
    enabled,
    name: LOGIN_ITEM_NAME,
    path: process.execPath,
    args: [AUTOSTART_ARGUMENT],
  })
  const state = getAutostartState()
  if (state.enabled !== enabled) {
    throw new Error("Couldn't update the startup setting.")
  }
  return state
}
