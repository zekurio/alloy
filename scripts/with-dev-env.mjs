import { spawn } from "node:child_process"

import { buildDevEnv, root, waitForDatabase } from "./dev-env.mjs"

const [command, ...args] = process.argv.slice(2)

if (!command) {
  process.stderr.write("[with-dev-env] Missing command to run.\n")
  process.exit(1)
}

const env = buildDevEnv()

try {
  await waitForDatabase(env.DATABASE_URL)
} catch (error) {
  process.stderr.write(`[with-dev-env] ${error.message}\n`)
  process.exit(1)
}

const executable = command === "node" ? process.execPath : command

const child = spawn(executable, args, {
  cwd: process.cwd() || root,
  env,
  stdio: "inherit",
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

child.on("error", (error) => {
  process.stderr.write(
    `[with-dev-env] ${executable} failed to start: ${error.message}\n`,
  )
  process.exit(1)
})
