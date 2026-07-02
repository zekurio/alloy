import { startMediaWorkers, stopMediaWorkers } from "./media-worker"
import { startReaperWorker, stopReaperWorker } from "./reaper"
import {
  startRenditionBackfill,
  stopRenditionBackfill,
} from "./renditions-backfill"

export async function startQueue(): Promise<void> {
  startMediaWorkers()
  await startReaperWorker()
  startRenditionBackfill()
}

export async function stopQueue(): Promise<void> {
  stopReaperWorker()
  stopRenditionBackfill()
  await stopMediaWorkers()
}

export { enqueueClipMediaProcessing } from "./media-worker"
