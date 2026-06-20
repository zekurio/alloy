import { decode } from "blurhash"

type BlurHashWorkerScope = {
  onmessage: ((event: MessageEvent<BlurHashWorkerRequest>) => void) | null
  postMessage: (message: unknown, transfer: Transferable[]) => void
}

type BlurHashWorkerRequest = {
  id: number
  hash: string
  width: number
  height: number
}

// This module only runs inside a dedicated worker, where the global scope
// carries the worker messaging surface. The DOM lib types `self` as `Window`,
// so widen it with a single targeted assertion instead of going via unknown.
const workerScope: BlurHashWorkerScope = self as typeof self &
  BlurHashWorkerScope

workerScope.onmessage = ({ data }) => {
  try {
    const pixels = decode(data.hash, data.width, data.height)
    workerScope.postMessage(
      {
        id: data.id,
        pixels,
        width: data.width,
        height: data.height,
      },
      [pixels.buffer],
    )
  } catch (cause) {
    workerScope.postMessage({ id: data.id, error: errorMessage(cause) }, [])
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "BlurHash decode failed"
}
