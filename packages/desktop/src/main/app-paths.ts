import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { app } from "electron"

const USER_DATA_DIR_NAME = "Alloy Desktop"
const SESSION_DATA_DIR_NAME = "session"
const LOGS_DIR_NAME = "logs"

/** Configure the Alloy 1.0 desktop state root before Electron opens it. */
export function configureAppPaths(): void {
  const roamingRoot = join(app.getPath("appData"), USER_DATA_DIR_NAME)
  const sessionDataPath = join(roamingRoot, SESSION_DATA_DIR_NAME)
  const logsPath = join(roamingRoot, LOGS_DIR_NAME)

  for (const path of [roamingRoot, sessionDataPath, logsPath]) {
    mkdirSync(path, { recursive: true })
  }

  app.setPath("userData", roamingRoot)
  app.setPath("sessionData", sessionDataPath)
  app.setAppLogsPath(logsPath)
}
