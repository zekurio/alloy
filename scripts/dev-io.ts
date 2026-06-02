export type SyncWriter = {
  writeSync(bytes: Uint8Array): number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class CommandFailedError extends Error {
  constructor(
    readonly label: string,
    readonly code: number,
  ) {
    super(`${label} command failed with code ${code}`)
    this.name = "CommandFailedError"
  }
}

export async function runLoggedCommand(
  label: string,
  command: string,
  args: string[],
  options: { env?: Record<string, string> } = {},
): Promise<void> {
  const child = new Deno.Command(command, {
    args,
    env: options.env,
    stdout: "piped",
    stderr: "piped",
  }).spawn()

  void pipeOutput(label, child.stdout, Deno.stdout)
  void pipeOutput(label, child.stderr, Deno.stderr)

  const status = await child.status
  if (!status.success) {
    const code = status.code ?? 1
    writeLine(Deno.stderr, label, `command failed with code ${code}.`)
    throw new CommandFailedError(label, code)
  }
}

export async function pipeOutput(
  label: string,
  readable: ReadableStream<Uint8Array>,
  writable: SyncWriter,
) {
  let pending = ""

  for await (const chunk of readable) {
    pending += decoder.decode(chunk, { stream: true })
    pending = flushCompleteLines(label, writable, pending)
  }

  pending += decoder.decode()
  if (pending.length > 0) {
    writeLine(writable, label, pending)
  }
}

function flushCompleteLines(
  label: string,
  writable: SyncWriter,
  output: string,
) {
  const lines = output.split(/\r?\n/)
  const pending = lines.pop() ?? ""

  for (const line of lines) {
    writeLine(writable, label, line)
  }

  return pending
}

export function writeLine(writable: SyncWriter, label: string, line: string) {
  writable.writeSync(
    encoder.encode(line.length === 0 ? "\n" : `[${label}] ${line}\n`),
  )
}
