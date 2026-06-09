import { spawn, spawnSync } from "node:child_process"
import { join } from "node:path"

import { buildDevEnv, root, waitForDatabase } from "./dev-env.mjs"

const isWindows = process.platform === "win32"

const processSpecs = {
  api: {
    filter: "alloy-server",
    needsDatabase: true,
  },
  server: {
    filter: "alloy-server",
    needsDatabase: true,
  },
  web: {
    filter: "alloy-web",
  },
  desktop: {
    filter: "alloy-desktop",
  },
  ml: {
    command: "uv",
    args: ["run", "python", "-m", "alloy_ml"],
    cwd: join(root, "machine-learning"),
    before: syncMachineLearning,
  },
}

const selectedNames = process.argv.slice(2)
const selected = selectedNames.length > 0 ? selectedNames : ["server"]

for (const name of selected) {
  if (!(name in processSpecs)) {
    fail(
      `Unknown dev process "${name}". Expected one of: ${Object.keys(processSpecs).join(", ")}`,
    )
  }
}

const env = buildDevEnv({ selected })

if (selected.some((name) => processSpecs[name].needsDatabase)) {
  try {
    await waitForDatabase(env.DATABASE_URL)
  } catch (error) {
    fail(error.message)
  }
  runChecked("pnpm", ["db:push"], { env })
}

const children = []
let shuttingDown = false

const filters = [
  ...new Set(
    selected
      .map((name) => processSpecs[name].filter)
      .filter((filter) => filter),
  ),
]

if (filters.length > 0) {
  spawnChild("pnpm", [
    "exec",
    "turbo",
    "run",
    "dev",
    ...filters.flatMap((filter) => ["--filter", filter]),
  ])
}

for (const name of selected) {
  const spec = processSpecs[name]
  if (!spec.command) continue
  if (spec.before) {
    spec.before(env)
  }
  spawnChild(spec.command, spec.args, { cwd: spec.cwd })
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

function spawnChild(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    env,
    detached: !isWindows,
    stdio: "inherit",
  })

  children.push(child)

  child.on("exit", (code, signal) => {
    if (shuttingDown) return
    shuttingDown = true
    stopChildren(child)
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 1)
  })
}

function syncMachineLearning(env) {
  if (env.MACHINE_LEARNING_UV_SYNC === "0") return

  runChecked(
    "uv",
    ["sync", "--extra", env.MACHINE_LEARNING_UV_EXTRA ?? "cpu"],
    {
      cwd: join(root, "machine-learning"),
      env,
    },
  )
}

function runChecked(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    stdio: "inherit",
  })

  if (result.error) {
    fail(`${command} failed to start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  stopChildren()
}

function stopChildren(except) {
  for (const child of children) {
    if (child === except || child.killed) continue
    stopChildTree(child)
  }
}

function fail(message) {
  process.stderr.write(`[dev] ${message}\n`)
  process.exit(1)
}

function stopChildTree(child) {
  if (!child.pid) return

  if (isWindows) {
    spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    })
    return
  }

  try {
    process.kill(-child.pid, "SIGTERM")
  } catch {
    child.kill("SIGTERM")
  }
}
