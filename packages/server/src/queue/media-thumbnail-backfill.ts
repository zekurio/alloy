import { abortMediaProcessing } from "./media-abort"
import {
  extractPosterBestEffort,
  materializeEffectiveMedia,
  publishRunThumbnail,
} from "./media-run-input"
import {
  ensureStillPresent,
  withMediaRunWorkspace,
} from "./media-run-workspace"
import type { MediaCompletion, MediaRow, MediaStore } from "./media-store"

export async function runThumbnailBackfill(
  store: MediaStore,
  id: string,
  row: MediaRow,
  runId: string,
  signal: AbortSignal,
  completion: MediaCompletion,
): Promise<void> {
  await withMediaRunWorkspace(
    { store, id, runId, row, cleanupLabel: "thumbnail" },
    async (workspace) => {
      const media = await materializeEffectiveMedia(store, id, row, runId, {
        workDir: workspace.workDir,
        signal,
      })
      await ensureStillPresent(store, id, runId, signal)

      const poster = await extractPosterBestEffort(
        media.path,
        workspace.workDir,
        {
          durationMs: media.durationMs,
          signal,
        },
      )
      if (poster.kind === "transient-error") {
        throw new Error("Thumbnail extraction failed transiently")
      }
      if (poster.kind === "permanent-empty") {
        if (!(await store.commitThumbFailed(id, runId, completion))) {
          throw abortMediaProcessing()
        }
        return
      }

      const thumb = await publishRunThumbnail(
        id,
        runId,
        poster.poster,
        workspace.uploadedKeys,
      )
      if (!(await store.commitThumb(id, runId, thumb))) {
        throw abortMediaProcessing()
      }
      workspace.retainedKeys.add(thumb.thumbKey)
      if (!(await store.finishThumbnailBackfill(id, runId, completion))) {
        throw abortMediaProcessing()
      }
      store.publishUpsert(row.authorId, id)
    },
  )
}
