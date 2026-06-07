import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { connect } from "node:net"
import { dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dataDir = join(root, "data")
const isWindows = process.platform === "win32"

const processSpecs = {
  api: {
    command: "pnpm",
    args: ["--dir", "apps/server", "dev"],
    needsDatabase: true,
  },
  server: {
    command: "pnpm",
    args: ["--dir", "apps/server", "dev"],
    needsDatabase: true,
  },
  web: {
    command: "pnpm",
    args: ["--dir", "apps/web", "dev"],
  },
  desktop: {
    command: "pnpm",
    args: ["--dir", "apps/desktop", "dev"],
  },
  ml: {
    command: "uv",
    args: ["run", "python", "-m", "alloy_ml"],
    cwd: join(root, "machine-learning"),
    before: syncMachineLearning,
  },
}

const selectedNames = process.argv.slice(2)
const selected = selectedNames.length > 0 ? selectedNames : ["api", "web", "ml"]

for (const name of selected) {
  if (!(name in processSpecs)) {
    fail(
      `Unknown dev process "${name}". Expected one of: ${Object.keys(processSpecs).join(", ")}`,
    )
  }
}

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: process.env.PORT ?? "2552",
  PUBLIC_SERVER_URL: process.env.PUBLIC_SERVER_URL ?? "http://localhost:2552",
  TRUSTED_ORIGINS:
    process.env.TRUSTED_ORIGINS ??
    "http://localhost:5173,http://127.0.0.1:5173",
  ALLOY_DATA_DIR: process.env.ALLOY_DATA_DIR ?? dataDir,
  ALLOY_CLIPS_DIR: process.env.ALLOY_CLIPS_DIR ?? join(dataDir, "clips"),
  ALLOY_ENCODE_DIR: process.env.ALLOY_ENCODE_DIR ?? join(dataDir, "encode"),
  MACHINE_LEARNING_ENABLED: process.env.MACHINE_LEARNING_ENABLED ?? "1",
  MACHINE_LEARNING_URL:
    process.env.MACHINE_LEARNING_URL ?? "http://localhost:2662",
  ALLOY_ML_HOST: process.env.ALLOY_ML_HOST ?? "0.0.0.0",
  ALLOY_ML_PORT: process.env.ALLOY_ML_PORT ?? "2662",
  MACHINE_LEARNING_CACHE_FOLDER:
    process.env.MACHINE_LEARNING_CACHE_FOLDER ?? join(dataDir, "ml"),
}

env.DATABASE_URL =
  process.env.DATABASE_URL ?? dockerDatabaseUrl() ?? localDatabaseUrl("5432")

if (selected.some((name) => processSpecs[name].needsDatabase)) {
  await waitForDatabase(env.DATABASE_URL)
  runChecked("pnpm", ["db:push"], { env })
}

const children = []
let shuttingDown = false

for (const name of selected) {
  const spec = processSpecs[name]
  if (spec.before) {
    spec.before(env)
  }

  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd ?? root,
    env,
    stdio: "inherit",
    shell: isWindows,
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

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

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
    shell: isWindows,
  })

  if (result.error) {
    fail(`${command} failed to start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function dockerDatabaseUrl() {
  const composeFile = join(root, "docker-compose.dev.yml")
  if (!existsSync(composeFile)) return undefined

  const result = spawnSync(
    "docker",
    ["compose", "-f", composeFile, "port", "postgres", "5432"],
    {
      cwd: root,
      encoding: "utf8",
      shell: isWindows,
      stdio: ["ignore", "pipe", "ignore"],
    },
  )

  if (result.status !== 0) return undefined

  const endpoint = result.stdout.trim().split(/\r?\n/).at(-1)
  if (!endpoint) return undefined

  const port = endpoint.match(/:(\d+)$/)?.[1]
  if (!port) return undefined

  return localDatabaseUrl(port)
}

function localDatabaseUrl(port) {
  const url = new URL("postgres://127.0.0.1")
  url.username = process.env.ALLOY_DEV_DATABASE_USER ?? "postgres"
  url.password = process.env.ALLOY_DEV_DATABASE_PASSWORD ?? "postgres"
  url.port = port
  url.pathname = "/alloy"
  return url.toString()
}

async function waitForDatabase(databaseUrl) {
  const endpoint = databaseEndpoint(databaseUrl)
  if (!endpoint) return

  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (await canConnect(endpoint)) return
    await sleep(500)
  }

  fail(
    `Could not connect to Postgres at ${endpoint.host}:${endpoint.port}. Start Docker Postgres or enter devenv before running API dev processes.`,
  )
}

function databaseEndpoint(databaseUrl) {
  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    return undefined
  }

  const socketHost = url.searchParams.get("host")
  if (socketHost?.startsWith("/")) return undefined

  return {
    host: url.hostname || socketHost || "127.0.0.1",
    port: Number(url.port || 5432),
  }
}

function canConnect(endpoint) {
  return new Promise((resolve) => {
    const socket = connect(endpoint)
    socket.setTimeout(1000)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
    socket.once("timeout", () => {
      socket.destroy()
      resolve(false)
    })
  })
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  stopChildren()
}

function stopChildren(except) {
  for (const child of children) {
    if (child === except || child.killed) continue
    child.kill("SIGTERM")
  }
}

function fail(message) {
  process.stderr.write(`[dev] ${message}\n`)
  process.exit(1)
}
