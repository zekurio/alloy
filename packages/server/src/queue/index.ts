import { startClipMediaWorker, stopClipMediaWorker } from "./media-worker"
import { startReaperWorker, stopReaperWorker } from "./reaper"

export async function startQueue(): Promise<void> {
  await startClipMediaWorker()
  await startReaperWorker()
}

export async function stopQueue(): Promise<void> {
  stopReaperWorker()
  await stopClipMediaWorker()
}

export { enqueueClipMediaProcessing } from "./media-worker"
