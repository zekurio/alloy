import { startMediaWorkers, stopMediaWorkers } from "./media-worker"
import { startReaperWorker, stopReaperWorker } from "./reaper"

export async function startQueue(): Promise<void> {
  startMediaWorkers()
  await startReaperWorker()
}

export async function stopQueue(): Promise<void> {
  stopReaperWorker()
  await stopMediaWorkers()
}

export { enqueueClipMediaProcessing } from "./media-worker"
