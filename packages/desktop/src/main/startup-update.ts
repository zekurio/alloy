import type { StartupUpdateState } from "@/shared/ipc"

export type StartupUpdateChoice = "continue" | "retry"
export type StartupUpdateResult = "continue" | "installing"

export class StartupDeadlineError extends Error {}

export type StartupUpdateCheck =
  | { kind: "current" }
  | { kind: "available"; version: string }
  | { kind: "unavailable"; message: string }

export interface StartupUpdateDriver {
  currentVersion: string
  check(): Promise<StartupUpdateCheck>
  download(version: string): Promise<void>
  install(): Promise<void>
  publish(state: StartupUpdateState): void
  choose(autoContinueMs: number | null): Promise<StartupUpdateChoice>
}

const OPERATION_ERROR_AUTO_CONTINUE_MS = 30_000

/**
 * Checks and installs before capture services start. Network failures have a
 * short automatic escape path. Download and install failures give the user
 * time to retry, then continue so startup cannot remain blocked.
 */
export async function runInteractiveStartupUpdate(
  driver: StartupUpdateDriver,
): Promise<StartupUpdateResult> {
  while (true) {
    driver.publish({
      phase: "checking",
      currentVersion: driver.currentVersion,
    })
    const check = await driver.check()
    if (check.kind === "current") return "continue"
    if (check.kind === "unavailable") {
      driver.publish({
        phase: "error",
        currentVersion: driver.currentVersion,
        version: null,
        message: check.message,
        autoContinueAt: null,
      })
      if ((await driver.choose(1_500)) === "retry") continue
      return "continue"
    }

    driver.publish({
      phase: "downloading",
      currentVersion: driver.currentVersion,
      version: check.version,
    })
    const downloadError = await driver
      .download(check.version)
      .then(() => null)
      .catch((cause: unknown) => errorMessage(cause))
    if (downloadError) {
      driver.publish({
        phase: "error",
        currentVersion: driver.currentVersion,
        version: check.version,
        message: downloadError,
        autoContinueAt: null,
      })
      if ((await driver.choose(OPERATION_ERROR_AUTO_CONTINUE_MS)) === "retry") {
        continue
      }
      return "continue"
    }

    driver.publish({
      phase: "installing",
      currentVersion: driver.currentVersion,
      version: check.version,
    })
    const installError = await driver
      .install()
      .then(() => null)
      .catch((cause: unknown) => errorMessage(cause))
    if (!installError) return "installing"

    driver.publish({
      phase: "error",
      currentVersion: driver.currentVersion,
      version: check.version,
      message: installError,
      autoContinueAt: null,
    })
    if ((await driver.choose(OPERATION_ERROR_AUTO_CONTINUE_MS)) === "retry") {
      continue
    }
    return "continue"
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The update failed."
}

/** Stops waiting without cancelling the handled operation behind the promise. */
export function withStartupDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new StartupDeadlineError(message)),
      timeoutMs,
    )
    void promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (cause: unknown) => {
        clearTimeout(timer)
        reject(cause instanceof Error ? cause : new Error(message))
      },
    )
  })
}
