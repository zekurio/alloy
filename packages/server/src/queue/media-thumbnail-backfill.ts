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
import type { MediaRow, MediaStore } from "./media-store"

export async function runThumbnailBackfill(
  store: MediaStore,
  id: string,
  row: MediaRow,
  runId: string,
  signal: AbortSignal,
): Promise<void> {
  await withMediaRunWorkspace(
    { store, id, row, cleanupLabel: "thumbnail" },
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
        await store.finishThumbnailBackfill(id, runId)
        return
      }
      if (poster.kind === "permanent-empty") {
        await store.commitThumbFailed(id, runId)
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
      if (!(await store.finishThumbnailBackfill(id, runId))) {
        throw abortMediaProcessing()
      }
      store.publishUpsert(row.authorId, id)
    },
  )
}
