import { openSync, readdirSync, unlinkSync, writeSync } from "node:fs"
import { join } from "node:path"

import { addLogSink, createLogger, formatRecord } from "@alloy/logging"
import { app, type WebContents } from "electron"

const logger = createLogger("main")
const rendererLogger = createLogger("renderer")

const LOG_FILE_RE = /^alloy-main-\d{4}-\d{2}-\d{2}\.log$/
const MAX_LOG_FILES = 14

/**
 * Mirror every log record into a date-stamped file under the app's logs
 * directory (%LOCALAPPDATA%/Alloy Desktop/logs). The packaged Windows app has
 * no console attached, so without a file sink production logs are lost
 * entirely. Writes are synchronous so the lines leading up to a crash make it
 * to disk; log volume is low enough that this is safe.
 */
export function installFileLogSink(): void {
  try {
    const dir = app.getPath("logs")
    const stamp = new Date().toISOString().slice(0, 10)
    const fd = openSync(join(dir, `alloy-main-${stamp}.log`), "a")
    addLogSink({
      write(record) {
        writeSync(fd, `${formatRecord(record, "human")}\n`)
      },
    })
    pruneOldLogFiles(dir)
  } catch (cause) {
    logger.warn("file logging unavailable:", cause)
  }
}

/**
 * Last-resort handlers so main-process crashes land in the log file instead
 * of an Electron error dialog nobody can copy text out of. Registering an
 * `uncaughtException` listener suppresses that dialog and keeps the tray app
 * alive, which is the better failure mode for a background recorder.
 */
export function installCrashLogging(): void {
  process.on("uncaughtException", (cause) => {
    logger.error("uncaught exception:", cause)
  })
  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled promise rejection:", reason)
  })
}

/**
 * Surface renderer errors in the main-process log. The main window runs the
 * remote web app, so this is the only place its production errors become
 * visible. Errors only — warnings from web frameworks are too noisy to keep.
 */
export function forwardRendererConsole(contents: WebContents): void {
  contents.on("console-message", (details) => {
    if (details.level !== "error") return
    rendererLogger.error(
      `${details.message} (${details.sourceId}:${details.lineNumber})`,
    )
  })
}

function pruneOldLogFiles(dir: string): void {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  // Date-stamped names sort lexicographically; keep the newest files.
  const expired = names
    .filter((name) => LOG_FILE_RE.test(name))
    .sort()
    .slice(0, -MAX_LOG_FILES)
  for (const name of expired) {
    try {
      unlinkSync(join(dir, name))
    } catch {
      // A locked or already-removed file must not break startup.
    }
  }
}
