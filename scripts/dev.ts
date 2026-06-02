import { CommandFailedError, runLoggedCommand, writeLine } from "./dev-io.ts"
import { acquireDevLock } from "./dev-lock.ts"
import {
  type DevProcess,
  type RunningDevProcess,
  startProcess,
  stopChildren,
} from "./dev-process.ts"
import {
  assertPortsAvailable,
  DEFAULT_API_PORT,
  DEFAULT_ML_PORT,
  DEFAULT_WEB_PORT,
  ensureDevPostgres,
  getDevEnv,
  readPortEnv,
} from "./dev-preflight.ts"

const args = new Set(Deno.args.filter((arg) => arg !== "--"))
if (args.has("--help") || args.has("-h")) {
  printUsage()
  Deno.exit(0)
}

const invalidArgs = args.difference(
  new Set(["--help", "--ml", "--no-ml", "--no-db-push", "-h"]),
)
if (invalidArgs.size > 0) {
  writeLine(
    Deno.stderr,
    "dev",
    `unknown option: ${[...invalidArgs].join(", ")}`,
  )
  printUsage()
  Deno.exit(1)
}

const includeMl = args.has("--no-ml")
  ? false
  : args.has("--ml") || Deno.env.get("ALLOY_DEV_ML") !== "0"
const pushDatabase = !args.has("--no-db-push") &&
  Deno.env.get("ALLOY_DEV_DB_PUSH") !== "0"
const devEnv = getDevEnv(includeMl)
const processes = buildProcessList(includeMl, devEnv)
const releaseDevLock = await acquireDevLock()
let shuttingDown = false
let running = new Set<RunningDevProcess>()

try {
  await ensureDevPostgres(devEnv.DATABASE_URL)
  if (pushDatabase) {
    await runLoggedCommand("db", Deno.execPath(), ["task", "db:push"], {
      env: devEnv,
    })
  }
  assertPortsAvailable(processes)
} catch (err) {
  releaseDevLock()
  if (err instanceof CommandFailedError) {
    Deno.exit(err.code)
  }
  throw err
}

running = new Set<RunningDevProcess>(
  processes.map((process) => startProcess(process)),
)

try {
  Deno.addSignalListener("SIGINT", () => {
    shutdown("SIGINT", 130)
  })
  Deno.addSignalListener("SIGTERM", () => {
    shutdown("SIGTERM", 143)
  })
  Deno.addSignalListener("SIGHUP", () => {
    shutdown("SIGHUP", 129)
  })
} catch {
  // Signal listeners are unavailable on some platforms.
}

while (running.size > 0) {
  const firstExit = await Promise.race(
    [...running].map(async (process) => {
      const status = await process.status
      return { process, status }
    }),
  )

  running.delete(firstExit.process)
  if (shuttingDown) {
    continue
  }

  const code = firstExit.status.code ?? (firstExit.status.success ? 0 : 1)
  const reason = firstExit.status.success
    ? "exited"
    : `failed with code ${code}`

  if (firstExit.process.optional) {
    writeLine(
      Deno.stderr,
      "dev",
      `${firstExit.process.label} ${reason}; continuing without it.`,
    )
    continue
  }

  writeLine(
    Deno.stderr,
    "dev",
    `${firstExit.process.label} ${reason}; stopping remaining dev processes.`,
  )
  await stopChildren(running, "SIGTERM")
  releaseDevLock()
  Deno.exit(code)
}

releaseDevLock()

function buildProcessList(
  includeMachineLearning: boolean,
  env: Record<string, string>,
): DevProcess[] {
  const processes: DevProcess[] = [
    {
      label: "api",
      args: ["task", "--quiet", "--cwd", "apps/server", "dev"],
      env,
      port: readPortEnv("PORT", DEFAULT_API_PORT),
    },
    {
      label: "web",
      args: ["task", "--quiet", "--cwd", "apps/web", "dev"],
      port: DEFAULT_WEB_PORT,
    },
  ]

  if (includeMachineLearning) {
    processes.push({
      label: "ml",
      args: ["task", "--quiet", "dev:ml"],
      optional: true,
      port: readPortEnv("ALLOY_ML_PORT", DEFAULT_ML_PORT),
    })
  }

  return processes
}

async function shutdown(signal: Deno.Signal, code: number) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  writeLine(Deno.stderr, "dev", `received ${signal}; stopping dev processes.`)
  await stopChildren(running, "SIGTERM")
  releaseDevLock()
  Deno.exit(code)
}

function printUsage() {
  writeLine(
    Deno.stdout,
    "dev",
    "Usage: deno task dev [-- --no-ml] [-- --no-db-push]",
  )
  writeLine(
    Deno.stdout,
    "dev",
    "  --no-ml        skip starting the optional ML service.",
  )
  writeLine(
    Deno.stdout,
    "dev",
    "  --no-db-push   skip applying the database schema before starting.",
  )
}
