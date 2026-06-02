import { startEncodeWorker, stopEncodeWorker } from "./encode-worker"
import { startReaperWorker, stopReaperWorker } from "./reaper"

export async function startQueue(): Promise<void> {
  await startEncodeWorker()
  await startReaperWorker()
}

export async function stopQueue(): Promise<void> {
  stopReaperWorker()
  await stopEncodeWorker()
}

export { enqueueEncode } from "./encode-worker"
