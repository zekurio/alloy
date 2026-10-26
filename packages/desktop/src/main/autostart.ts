import type { DesktopAutostartState } from "@alloy/contracts/desktop-autostart"
import { app } from "electron"

import { log } from "./log"

/**
 * The login item passes this, and such a start stays in the tray with no
 * window. The NSIS installer writes the same command.
 */
export const AUTOSTART_ARGUMENT = "--autostart"
/**
 * The registry value under `HKCU\...\CurrentVersion\Run`. The Tauri host
 * registered the same name, so an existing choice carries over, and the
 * installer points it at the new executable.
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

function loginItem() {
  return app
    .getLoginItemSettings({ args: [AUTOSTART_ARGUMENT] })
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
  // command line, which differs in quoting from what the installer and the
  // Tauri host wrote. `enabled` reflects Task Manager's startup toggle.
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

/**
 * Points an enabled login item at this executable when it names another
 * one, for example the Tauri build this install replaced.
 */
export function repairAutostart(): void {
  if (!supported()) return
  const item = loginItem()
  if (
    !item?.enabled ||
    item.path.toLowerCase() === process.execPath.toLowerCase()
  ) {
    return
  }
  log.info("Pointing the login item at the current executable.")
  setAutostartEnabled(true)
}
