import { trimToMp4Target } from "@alloy/media"
import { ALL_FORMATS, BlobSource, BufferTarget, Input } from "mediabunny"

/**
 * Cut `[startMs, endMs]` out of a picked video `File` into a new MP4 File,
 * entirely in the browser via mediabunny packet copy — no re-encode, no
 * WebCodecs. Shares the keyframe-snapped core with the server and desktop
 * (`@alloy/media`). The whole output is held in memory (`BufferTarget`), so
 * callers should skip this for full-range "trims" and upload the original
 * disk-backed File untouched.
 */
export async function trimFileToMp4(
  file: File,
  opts: { startMs: number; endMs: number; signal?: AbortSignal },
): Promise<File> {
  const target = new BufferTarget()
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  })
  try {
    await trimToMp4Target({
      input,
      target,
      startMs: opts.startMs,
      endMs: opts.endMs,
      signal: opts.signal,
      sourceLabel: "Clip",
    })
  } finally {
    input.dispose()
  }

  if (!target.buffer) throw new Error("Trim produced no output.")
  return new File([target.buffer], toMp4Name(file.name), { type: "video/mp4" })
}

function toMp4Name(name: string): string {
  const dot = name.lastIndexOf(".")
  const base = dot > 0 ? name.slice(0, dot) : name
  return `${base}.mp4`
}
