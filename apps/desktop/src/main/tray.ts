import { Menu, nativeImage, Tray } from "electron"

import { WINDOW_ICON } from "./windows"

type AlloyTrayOptions = {
  showAlloy: () => void | Promise<void>
  openSettings: () => void
  stopRecording: () => void | Promise<void>
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
      label: "Show Alloy",
      click: () => {
        void options.showAlloy()
      },
    },
    {
      label: "Settings",
      click: () => {
        options.openSettings()
      },
    },
    {
      label: "Stop Recording",
      click: () => {
        void options.stopRecording()
      },
    },
    { type: "separator" },
    {
      label: "Quit Alloy",
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
