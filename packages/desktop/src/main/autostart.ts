import type { DesktopAutostartState } from "@alloy/contracts"
import { app } from "electron"

/**
 * Windows AppUserModelId, also used as the login-item registry value name
 * under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. The NSIS
 * installer writes/removes the same value (`${APP_ID}` in
 * `packages/desktop/nsis/installer.nsh`), so the installer checkbox and the
 * in-app toggle manage one entry. Must stay in sync with `appId` in
 * `packages/desktop/package.json`.
 */
export const WINDOWS_APP_USER_MODEL_ID = "dev.zekurio.alloy.desktop"

/**
 * Argument passed by the login-item entry so the shell knows it was launched
 * at sign-in and should stay in the tray instead of opening a window. The
 * installer bakes the same flag into the Run command.
 */
const AUTOSTART_LAUNCH_ARG = "--autostart"

// Dev builds would register the bare Electron binary; never do that. Login
// items are only implemented for Windows and macOS.
const AUTOSTART_SUPPORTED =
  app.isPackaged &&
  (process.platform === "win32" || process.platform === "darwin")

export function wasLaunchedAtLogin(): boolean {
  if (process.platform === "win32") {
    return process.argv.includes(AUTOSTART_LAUNCH_ARG)
  }
  if (process.platform === "darwin") {
    return app.getLoginItemSettings().wasOpenedAtLogin
  }
  return false
}

export function getAutostartState(): DesktopAutostartState {
  if (!AUTOSTART_SUPPORTED) return { supported: false, enabled: false }
  if (process.platform === "darwin") {
    return { supported: true, enabled: app.getLoginItemSettings().openAtLogin }
  }

  // Match by registry value name instead of `openAtLogin`: Electron's
  // openAtLogin requires an exact command-string match, which breaks against
  // the installer-written entry over quoting differences. `launchItems` is
  // parsed from the registry command line and carries the Task Manager
  // enabled/disabled state.
  const item = app
    .getLoginItemSettings()
    .launchItems.find(
      (candidate) =>
        candidate.name.toLowerCase() ===
        WINDOWS_APP_USER_MODEL_ID.toLowerCase(),
    )
  return { supported: true, enabled: item?.enabled === true }
}

export function setAutostartEnabled(enabled: boolean): DesktopAutostartState {
  if (!AUTOSTART_SUPPORTED) return { supported: false, enabled: false }
  if (process.platform === "darwin") {
    app.setLoginItemSettings({ openAtLogin: enabled })
    return getAutostartState()
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    name: WINDOWS_APP_USER_MODEL_ID,
    args: [AUTOSTART_LAUNCH_ARG],
  })
  return getAutostartState()
}
