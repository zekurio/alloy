import { startEncodeWorker, stopEncodeWorker } from "./encode-worker"
import { startReaperWorker, stopReaperWorker } from "./reaper"

export async function startQueue(): Promise<void> {
  await startEncodeWorker()
  await startReaperWorker()
  // eslint-disable-next-line no-console
}

export async function stopQueue(): Promise<void> {
  stopReaperWorker()
  await stopEncodeWorker()
}

export { ENCODE_JOB, enqueueEncode } from "./encode-worker"
