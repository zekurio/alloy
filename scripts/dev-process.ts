import { pipeOutput } from "./dev-io.ts"

export type DevProcess = {
  label: string
  args: string[]
  optional?: boolean
  env?: Record<string, string>
  port?: number
}

export type RunningDevProcess = DevProcess & {
  child: Deno.ChildProcess
  exited: boolean
  processGroupPid: number | null
  status: Promise<Deno.CommandStatus>
}

const supportsProcessGroups = Deno.build.os === "linux"

export function startProcess(process: DevProcess): RunningDevProcess {
  const command = getDevCommand(process)
  const child = new Deno.Command(command.command, {
    args: command.args,
    env: process.env,
    stdout: "piped",
    stderr: "piped",
  }).spawn()

  const runningProcess: RunningDevProcess = {
    ...process,
    child,
    exited: false,
    processGroupPid: command.usesProcessGroup ? child.pid : null,
    status: child.status.then((status) => {
      runningProcess.exited = true
      return status
    }),
  }

  void pipeOutput(process.label, child.stdout, Deno.stdout)
  void pipeOutput(process.label, child.stderr, Deno.stderr)

  return runningProcess
}

export async function stopChildren(
  running: Set<RunningDevProcess>,
  signal: Deno.Signal,
) {
  for (const process of running) {
    stopProcess(process, signal)
  }

  const statuses = [...running].map((process) => process.status)
  const settled = Promise.allSettled(statuses)
  const timeout = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), 5_000)
  })

  if ((await Promise.race([settled, timeout])) === "timeout") {
    for (const process of running) {
      stopProcess(process, "SIGKILL")
    }

    await settled
  }
}

function getDevCommand(process: DevProcess) {
  if (!supportsProcessGroups) {
    return {
      command: Deno.execPath(),
      args: process.args,
      usesProcessGroup: false,
    }
  }

  return {
    command: "setsid",
    args: [Deno.execPath(), ...process.args],
    usesProcessGroup: true,
  }
}

function stopProcess(process: RunningDevProcess, signal: Deno.Signal) {
  if (process.exited) {
    return
  }

  if (process.processGroupPid !== null) {
    try {
      Deno.kill(-process.processGroupPid, signal)
      return
    } catch {
      // Fall back to the direct child if the process group is already gone.
    }
  }

  try {
    process.child.kill(signal)
  } catch {
    // The process may have exited between the status check and signal.
  }
}
