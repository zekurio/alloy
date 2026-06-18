import { t } from "@alloy/i18n"
import { Menu, nativeImage, Tray } from "electron"

import { WINDOW_ICON } from "./windows"

type AlloyTrayOptions = {
  showAlloy: () => void | Promise<void>
  openLibrary: () => void | Promise<void>
  openSettings: () => void
  quit: () => void
}

let tray: Tray | null = null

export function createAlloyTray(options: AlloyTrayOptions): Tray {
  if (tray) return tray

  tray = new Tray(createTrayImage())
  tray.setToolTip("Alloy")
  tray.setContextMenu(createTrayMenu(options))
  tray.on("click", () => {
    void options.showAlloy()
  })

  return tray
}

function createTrayMenu(options: AlloyTrayOptions): Menu {
  return Menu.buildFromTemplate([
    {
      label: t("Show Alloy"),
      click: () => {
        void options.showAlloy()
      },
    },
    {
      label: t("Library"),
      click: () => {
        void options.openLibrary()
      },
    },
    {
      label: t("Settings"),
      click: () => {
        options.openSettings()
      },
    },
    {
      label: t("Quit Alloy"),
      click: () => {
        options.quit()
      },
    },
  ])
}

function createTrayImage(): Electron.NativeImage {
  const image = nativeImage.createFromPath(WINDOW_ICON)
  if (process.platform === "darwin") image.setTemplateImage(true)
  if (image.isEmpty()) return image

  return image.resize({ height: 16, width: 16 })
}
