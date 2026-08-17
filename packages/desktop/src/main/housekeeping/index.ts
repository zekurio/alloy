import { join } from "node:path"

import { createLogger } from "@alloy/logging"
import { app } from "electron"

import { activeHousekeepingPaths } from "./active-paths"
import { HousekeepingCoordinator } from "./core"
import { createDesktopHousekeepingTasks } from "./tasks"

const INITIAL_SWEEP_DELAY_MS = 5000
const SWEEP_POLL_INTERVAL_MS = 60 * 60 * 1000

const logger = createLogger("housekeeping")

let coordinator: HousekeepingCoordinator | null = null
let initialTimer: ReturnType<typeof setTimeout> | null = null
let intervalTimer: ReturnType<typeof setInterval> | null = null

export function startDesktopHousekeeping(): void {
  if (coordinator) return

  coordinator = new HousekeepingCoordinator({
    ledgerPath: join(app.getPath("userData"), "housekeeping", "state.json"),
    tasks: createDesktopHousekeepingTasks({
      userData: app.getPath("userData"),
      logs: app.getPath("logs"),
      activeAssetPaths: () => activeHousekeepingPaths("asset"),
      activeAudioPaths: () => activeHousekeepingPaths("audio"),
      activeExportPaths: () => activeHousekeepingPaths("export"),
      activeImportPaths: () => activeHousekeepingPaths("import"),
    }),
    logger: {
      info: (message) => logger.info(message),
      warn: (message, cause) => logger.warn(message, cause),
    },
  })

  initialTimer = setTimeout(runDesktopHousekeeping, INITIAL_SWEEP_DELAY_MS)
  initialTimer.unref?.()
  intervalTimer = setInterval(runDesktopHousekeeping, SWEEP_POLL_INTERVAL_MS)
  intervalTimer.unref?.()
}

export function stopDesktopHousekeeping(): void {
  if (initialTimer) clearTimeout(initialTimer)
  if (intervalTimer) clearInterval(intervalTimer)
  initialTimer = null
  intervalTimer = null
  coordinator?.stop()
  coordinator = null
}

function runDesktopHousekeeping(): void {
  void coordinator?.runDue().catch((cause: unknown) => {
    logger.warn("desktop housekeeping lane failed", cause)
  })
}
