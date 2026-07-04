import { startMediaWorkers, stopMediaWorkers } from "./media-worker"
import { startReaperWorker, stopReaperWorker } from "./reaper"
import {
  startRenditionBackfill,
  stopRenditionBackfill,
} from "./renditions-backfill"
import {
  startSourceProbeBackfill,
  stopSourceProbeBackfill,
} from "./source-probe-backfill"

export async function startQueue(): Promise<void> {
  startMediaWorkers()
  await startReaperWorker()
  // Both trickle independently; the probe backfill's conditional updates
  // yield to any media run the rendition backfill (or a trim) kicks off.
  startSourceProbeBackfill()
  startRenditionBackfill()
}

export async function stopQueue(): Promise<void> {
  stopReaperWorker()
  stopSourceProbeBackfill()
  stopRenditionBackfill()
  await stopMediaWorkers()
}

export { enqueueClipMediaProcessing } from "./media-worker"
