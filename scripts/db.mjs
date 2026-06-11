import { spawnSync } from "node:child_process"
import { join } from "node:path"

import { buildDevEnv, root, waitForDatabase } from "./dev-env.mjs"

const command = process.argv[2]
const passthroughArgs = process.argv.slice(3)

if (!command) {
  fail(
    "Expected a drizzle-kit command, e.g. generate, migrate, push, or studio.",
  )
}

const env = buildDevEnv()

if (command !== "generate") {
  try {
    await waitForDatabase(env.DATABASE_URL)
  } catch (error) {
    fail(error.message)
  }
}

const result = spawnSync(
  "pnpm",
  ["exec", "drizzle-kit", command, ...passthroughArgs],
  {
    cwd: join(root, "packages", "db"),
    env,
    stdio: "inherit",
  },
)

if (result.error) {
  fail(`drizzle-kit ${command} failed to start: ${result.error.message}`)
}

process.exit(result.status ?? 1)

function fail(message) {
  process.stderr.write(`[db] ${message}\n`)
  process.exit(1)
}
