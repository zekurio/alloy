import { existsSync, mkdirSync, renameSync, rmdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { app } from "electron"

const USER_DATA_DIR_NAME = "Alloy Desktop"
const SESSION_DATA_DIR_NAME = "session"
const LOGS_DIR_NAME = "logs"
const UPDATER_TEMP_DIR_NAME = "Alloy"
const LEGACY_UPDATER_CACHE_DIR_NAME = "@alloydesktop-updater"

/**
 * Keep every persistent per-user file under Roaming. Older builds split the
 * Chromium session and logs into Local, so move those directories before
 * Electron opens either one.
 */
export function configureAppPaths(): void {
  const roamingRoot = join(app.getPath("appData"), USER_DATA_DIR_NAME)
  mkdirSync(roamingRoot, { recursive: true })

  const localRoot = join(
    process.env.LOCALAPPDATA || app.getPath("appData"),
    USER_DATA_DIR_NAME,
  )
  const sessionDataPath = migrateLegacyDirectory(
    join(localRoot, SESSION_DATA_DIR_NAME),
    join(roamingRoot, SESSION_DATA_DIR_NAME),
  )
  const logsPath = migrateLegacyDirectory(
    join(localRoot, LOGS_DIR_NAME),
    join(roamingRoot, LOGS_DIR_NAME),
  )

  for (const path of [sessionDataPath, logsPath]) {
    mkdirSync(path, { recursive: true })
  }

  removeEmptyDirectory(localRoot)
  app.setPath("userData", roamingRoot)
  app.setPath("sessionData", sessionDataPath)
  app.setAppLogsPath(logsPath)
}

/** Updater downloads are transient and do not belong beside persistent data. */
export function updaterCacheRoot(): string {
  return join(app.getPath("temp"), UPDATER_TEMP_DIR_NAME)
}

/**
 * Fixed installers stop creating this cache, but the first upgrade can still
 * be running from it. Cleanup is delayed by the caller and retried next launch
 * if Windows still has an installer file open.
 */
export function cleanupLegacyLocalAppData(): void {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return

  try {
    rmSync(join(localAppData, LEGACY_UPDATER_CACHE_DIR_NAME), {
      recursive: true,
      force: true,
    })
  } catch {
    // The installer may still be exiting after relaunching the app.
  }

  removeEmptyDirectory(join(localAppData, USER_DATA_DIR_NAME))
}

function migrateLegacyDirectory(source: string, destination: string): string {
  if (!existsSync(source) || existsSync(destination)) return destination

  try {
    renameSync(source, destination)
    return destination
  } catch {
    // Preserve the existing session/logs when migration is temporarily blocked.
    return source
  }
}

function removeEmptyDirectory(path: string): void {
  try {
    rmdirSync(path)
  } catch {
    // Missing and non-empty directories need no action.
  }
}
