import { t } from "@alloy/i18n"
import { Menu, nativeImage, Tray } from "electron"

import type { Host } from "./host"
import { appIconPath } from "./paths"
import { showActive, showSettings } from "./windows"

let tray: Tray | null = null

/**
 * Left click shows the app, right click opens the menu. Closing a window
 * keeps Alloy running here; Quit from the menu ends it.
 */
export function createTray(host: Host, quit: () => void): void {
  if (tray) return
  // Windows picks the tray size from the `.ico`; elsewhere the logo is
  // scaled down from its full size.
  const icon = nativeImage.createFromPath(appIconPath())
  tray = new Tray(
    process.platform === "win32" || icon.isEmpty()
      ? icon
      : icon.resize({ width: 32, height: 32 }),
  )
  tray.setToolTip("Alloy")
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t("Show Alloy"), click: () => showActive(host) },
      { label: t("Settings"), click: () => showSettings(host) },
      { type: "separator" },
      { label: t("Quit Alloy"), click: quit },
    ]),
  )
  tray.on("click", () => showActive(host))
}
