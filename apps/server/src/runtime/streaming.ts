type PipeTarget = {
  aborted: boolean
  pipe(body: ReadableStream<Uint8Array>): Promise<void>
}

export async function pipeReadable(
  stream: PipeTarget,
  body: ReadableStream<Uint8Array>,
): Promise<void> {
  try {
    await stream.pipe(body)
  } catch (err) {
    if (stream.aborted) return
    throw err
  }
}
