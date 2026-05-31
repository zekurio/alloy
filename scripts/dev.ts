type DevProcess = {
  label: string;
  args: string[];
};

type RunningDevProcess = DevProcess & {
  child: Deno.ChildProcess;
  exited: boolean;
  status: Promise<Deno.CommandStatus>;
};

type SyncWriter = {
  writeSync(bytes: Uint8Array): number;
};

const processes: DevProcess[] = [
  {
    label: "api",
    args: ["task", "--quiet", "--cwd", "apps/server", "dev"],
  },
  {
    label: "web",
    args: ["task", "--quiet", "--cwd", "apps/web", "dev"],
  },
  {
    label: "ml",
    args: ["task", "--quiet", "dev:ml"],
  },
];

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const running = new Set<RunningDevProcess>();
let shuttingDown = false;

for (const process of processes) {
  const child = new Deno.Command(Deno.execPath(), {
    args: process.args,
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const runningProcess: RunningDevProcess = {
    ...process,
    child,
    exited: false,
    status: child.status.then((status) => {
      runningProcess.exited = true;
      return status;
    }),
  };

  running.add(runningProcess);
  pipeOutput(process.label, child.stdout, Deno.stdout);
  pipeOutput(process.label, child.stderr, Deno.stderr);
}

try {
  Deno.addSignalListener("SIGINT", () => {
    shutdown("SIGINT", 130);
  });
  Deno.addSignalListener("SIGTERM", () => {
    shutdown("SIGTERM", 143);
  });
} catch {
  // Signal listeners are unavailable on some platforms.
}

const firstExit = await Promise.race(
  [...running].map(async (process) => {
    const status = await process.status;
    return { process, status };
  }),
);

if (!shuttingDown) {
  const code = firstExit.status.code ?? (firstExit.status.success ? 0 : 1);
  const reason = firstExit.status.success
    ? "exited"
    : `failed with code ${code}`;
  writeLine(
    Deno.stderr,
    "dev",
    `${firstExit.process.label} ${reason}; stopping remaining dev processes.`,
  );
  await stopChildren("SIGTERM");
  Deno.exit(code);
}

async function shutdown(signal: Deno.Signal, code: number) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  writeLine(Deno.stderr, "dev", `received ${signal}; stopping dev processes.`);
  await stopChildren("SIGTERM");
  Deno.exit(code);
}

async function stopChildren(signal: Deno.Signal) {
  for (const process of running) {
    if (!process.exited) {
      try {
        process.child.kill(signal);
      } catch {
        // The process may have exited between the status check and signal.
      }
    }
  }

  const statuses = [...running].map((process) => process.status);
  const settled = Promise.allSettled(statuses);
  const timeout = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), 5_000);
  });

  if (await Promise.race([settled, timeout]) === "timeout") {
    for (const process of running) {
      if (!process.exited) {
        try {
          process.child.kill("SIGKILL");
        } catch {
          // The process may have exited before the forced stop.
        }
      }
    }

    await settled;
  }
}

async function pipeOutput(
  label: string,
  readable: ReadableStream<Uint8Array>,
  writable: SyncWriter,
) {
  let pending = "";

  for await (const chunk of readable) {
    pending += decoder.decode(chunk, { stream: true });
    pending = flushCompleteLines(label, writable, pending);
  }

  pending += decoder.decode();
  if (pending.length > 0) {
    writeLine(writable, label, pending);
  }
}

function flushCompleteLines(
  label: string,
  writable: SyncWriter,
  output: string,
) {
  const lines = output.split(/\r?\n/);
  const pending = lines.pop() ?? "";

  for (const line of lines) {
    writeLine(writable, label, line);
  }

  return pending;
}

function writeLine(writable: SyncWriter, label: string, line: string) {
  writable.writeSync(
    encoder.encode(line.length === 0 ? "\n" : `[${label}] ${line}\n`),
  );
}
