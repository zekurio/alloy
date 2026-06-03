import { Buffer } from "node:buffer"

async function which(binary: string): Promise<string | null> {
  const command = new Deno.Command("which", {
    args: [binary],
    stdout: "piped",
    stderr: "null",
  })
  const output = await command.output()
  if (!output.success) return null
  const path = new TextDecoder().decode(output.stdout).trim()
  return path.length > 0 ? path : null
}

async function imageMagickBinary(): Promise<string> {
  const magick = await which("magick")
  if (magick) return magick

  const convert = await which("convert")
  if (convert) return convert

  throw new Error("ImageMagick is not installed")
}

export async function runImageMagick(
  args: string[],
  input: Uint8Array,
): Promise<Buffer> {
  const command = await imageMagickBinary()
  const child = new Deno.Command(command, {
    args,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  })
  const process = child.spawn()
  const writer = process.stdin.getWriter()
  await writer.write(input)
  await writer.close()
  const { stdout, stderr, success } = await process.output()
  if (!success) {
    const message = new TextDecoder().decode(stderr).trim()
    throw new Error(message || "ImageMagick failed")
  }
  return Buffer.from(stdout)
}
