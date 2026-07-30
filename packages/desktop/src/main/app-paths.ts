import { existsSync, mkdirSync, renameSync, rmdirSync } from "node:fs"
import { join } from "node:path"

import { app } from "electron"

const USER_DATA_DIR_NAME = "Alloy Desktop"
const SESSION_DATA_DIR_NAME = "session"
const LOGS_DIR_NAME = "logs"

/**
 * Keep every persistent per-user file under Roaming. Older builds split the
 * Chromium session and logs into Local, so move those directories before
 * Electron opens either one. Runs before the file log sink exists, so it
 * returns warnings for the caller to log once logging is up.
 */
export function configureAppPaths(): string[] {
  const roamingRoot = join(app.getPath("appData"), USER_DATA_DIR_NAME)
  mkdirSync(roamingRoot, { recursive: true })

  const warnings: string[] = []
  // The Local/Roaming split only exists on Windows; elsewhere there is no
  // legacy location to migrate away from.
  const localRoot = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, USER_DATA_DIR_NAME)
    : null
  const sessionDataPath = localRoot
    ? migrateLegacyDirectory(
        join(localRoot, SESSION_DATA_DIR_NAME),
        join(roamingRoot, SESSION_DATA_DIR_NAME),
        warnings,
      )
    : join(roamingRoot, SESSION_DATA_DIR_NAME)
  const logsPath = localRoot
    ? migrateLegacyDirectory(
        join(localRoot, LOGS_DIR_NAME),
        join(roamingRoot, LOGS_DIR_NAME),
        warnings,
      )
    : join(roamingRoot, LOGS_DIR_NAME)

  for (const path of [sessionDataPath, logsPath]) {
    mkdirSync(path, { recursive: true })
  }

  if (localRoot) removeEmptyDirectory(localRoot)
  app.setPath("userData", roamingRoot)
  app.setPath("sessionData", sessionDataPath)
  app.setAppLogsPath(logsPath)
  return warnings
}

function migrateLegacyDirectory(
  source: string,
  destination: string,
  warnings: string[],
): string {
  if (!existsSync(source)) return destination

  try {
    // An empty destination (e.g. created by a run that never wrote anything)
    // must not strand the legacy data; rename refuses to overwrite, so drop
    // it first. rmdir fails on a non-empty destination, landing in the catch.
    if (existsSync(destination)) rmdirSync(destination)
    renameSync(source, destination)
    return destination
  } catch {
    if (existsSync(destination)) {
      warnings.push(
        `legacy data at ${source} was left in place; ${destination} already has data`,
      )
      return destination
    }
    warnings.push(
      `could not move ${source} to ${destination}; staying on the legacy path`,
    )
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
