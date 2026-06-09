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

const workerScope = self as unknown as BlurHashWorkerScope

workerScope.onmessage = ({ data }) => {
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
}
