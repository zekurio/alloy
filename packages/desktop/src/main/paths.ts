import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { app } from "electron"

/** The bundle identifier the Tauri host used; its folders keep this name. */
export const APP_IDENTIFIER = "dev.zekurio.alloy"

export interface AppFolders {
  /**
   * Settings, saved servers, the capture manifest, and notification sounds.
   * Roams with a Windows profile.
   */
  data: string
  /**
   * Regenerable data: thumbnails, import staging, export renders, recorder
   * scratch, and detection caches. Never roams.
   */
  cache: string
  logs: string
  /** Chromium's profile: cookies, storage, and caches of every window. */
  shell: string
  replayScratch: string
  defaultOutput: string
  /** The staged or packaged `agent/`, `obs-runtime/`, `ffmpeg/`, `native/`. */
  nativeRoot: string
}

/**
 * The folders the Tauri host used, so settings, saved servers, the library,
 * and logs carry over. Chromium's profile is new: the WebView2 profiles under
 * the old `webviews` folder cannot be read by Electron.
 */
export function resolveFolders(): AppFolders {
  const nativeRoot = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), "resources")
  const defaultOutput = join(app.getPath("videos"), "Alloy")
  if (process.platform === "win32") {
    const local = join(
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
      APP_IDENTIFIER,
    )
    return {
      data: join(app.getPath("appData"), APP_IDENTIFIER),
      cache: local,
      logs: join(local, "logs"),
      shell: join(local, "electron"),
      replayScratch: join(tmpdir(), "Alloy", "replay"),
      defaultOutput,
      nativeRoot,
    }
  }
  // XDG locations. The replay buffer stays out of `/tmp`, which is often in
  // memory.
  const home = homedir()
  const data = join(
    process.env.XDG_DATA_HOME || join(home, ".local", "share"),
    APP_IDENTIFIER,
  )
  const cache = join(
    process.env.XDG_CACHE_HOME || join(home, ".cache"),
    APP_IDENTIFIER,
  )
  return {
    data,
    cache,
    logs: join(data, "logs"),
    shell: join(app.getPath("appData"), APP_IDENTIFIER),
    replayScratch: join(cache, "replay"),
    defaultOutput,
    nativeRoot,
  }
}

/** The addon staged by `scripts/build-addon.mjs`. */
export function nativeAddonPath(folders: AppFolders): string {
  return join(folders.nativeRoot, "native", "alloy-desktop.node")
}

/** The window and tray icon: `.ico` on Windows, the PNG logo elsewhere. */
export function appIconPath(): string {
  const name = process.platform === "win32" ? "icon.ico" : "icon.png"
  if (app.isPackaged) return join(process.resourcesPath, "assets", name)
  return process.platform === "win32"
    ? join(app.getAppPath(), "assets", name)
    : join(app.getAppPath(), "..", "..", "public", "logo.png")
}
