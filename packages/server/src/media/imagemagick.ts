import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"

async function hasImageMagickBinary(binary: string): Promise<boolean> {
  try {
    const output = await runProcess(binary, ["-version"])
    return output.code === 0
  } catch {
    return false
  }
}

async function imageMagickBinary(): Promise<string> {
  if (await hasImageMagickBinary("magick")) return "magick"

  if (await hasImageMagickBinary("convert")) return "convert"

  throw new Error("ImageMagick is not installed")
}

export async function runImageMagick(
  args: string[],
  input: Uint8Array,
): Promise<Buffer> {
  const command = await imageMagickBinary()
  const output = await runProcess(command, args, input)
  if (output.code !== 0) {
    const message = output.stderr.trim()
    throw new Error(message || "ImageMagick failed")
  }
  return output.stdoutBuffer
}

async function runProcess(
  command: string,
  args: ReadonlyArray<string>,
  input?: Uint8Array,
): Promise<{
  code: number
  stdout: string
  stderr: string
  stdoutBuffer: Buffer
}> {
  const proc = spawn(command, [...args], {
    stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
  })
  const exit = new Promise<number>((resolve, reject) => {
    proc.once("error", reject)
    proc.once("close", (code) => resolve(code ?? 1))
  })
  if (input && proc.stdin) {
    proc.stdin.end(input)
  }
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  if (!proc.stdout || !proc.stderr) {
    throw new Error(`${command} pipe setup failed`)
  }
  const stdout = proc.stdout
  const stderr = proc.stderr
  await Promise.all([
    (async () => {
      for await (const chunk of stdout) stdoutChunks.push(Buffer.from(chunk))
    })(),
    (async () => {
      for await (const chunk of stderr) stderrChunks.push(Buffer.from(chunk))
    })(),
  ])
  const stdoutBuffer = Buffer.concat(stdoutChunks)
  return {
    code: await exit,
    stdout: stdoutBuffer.toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
    stdoutBuffer,
  }
}
