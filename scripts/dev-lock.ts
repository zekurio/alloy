import { writeLine } from "./dev-io.ts"

const encoder = new TextEncoder()
const DEV_LOCK_FILE = ".alloy-dev.lock"

export async function acquireDevLock(): Promise<() => void> {
  while (true) {
    try {
      const lockFile = Deno.openSync(DEV_LOCK_FILE, {
        createNew: true,
        write: true,
      })
      lockFile.writeSync(encoder.encode(`${Deno.pid}\n`))

      let released = false
      return () => {
        if (released) {
          return
        }

        released = true
        try {
          lockFile.close()
        } catch {
          // The descriptor may already be closed during process teardown.
        }

        try {
          Deno.removeSync(DEV_LOCK_FILE)
        } catch {
          // Another process may have already cleaned up a stale lock.
        }
      }
    } catch (err) {
      if (!(err instanceof Deno.errors.AlreadyExists)) {
        throw err
      }

      const lockedPid = await readLockPid()
      if (lockedPid !== null && (await isProcessRunning(lockedPid))) {
        writeLine(
          Deno.stderr,
          "dev",
          `another dev supervisor is already running with pid ${lockedPid}; stop it first or remove ${DEV_LOCK_FILE} if that process is gone.`
        )
        Deno.exit(1)
      }

      writeLine(Deno.stderr, "dev", `removing stale ${DEV_LOCK_FILE}.`)
      try {
        Deno.removeSync(DEV_LOCK_FILE)
      } catch (removeErr) {
        if (!(removeErr instanceof Deno.errors.NotFound)) {
          throw removeErr
        }
      }
    }
  }
}

async function readLockPid(): Promise<number | null> {
  try {
    const value = (await Deno.readTextFile(DEV_LOCK_FILE)).trim()
    if (!/^\d+$/.test(value)) {
      return null
    }

    return Number(value)
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return null
    }
    throw err
  }
}

async function isProcessRunning(pid: number): Promise<boolean> {
  const status = await new Deno.Command("sh", {
    args: ["-c", `kill -0 "$1" >/dev/null 2>&1`, "sh", String(pid)],
    stdout: "null",
    stderr: "null",
  }).spawn().status

  return status.success
}
