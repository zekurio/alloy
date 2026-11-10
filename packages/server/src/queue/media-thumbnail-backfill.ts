import { publishClipUpsert } from "@alloy/server/clips/events"

import {
  commitThumb,
  commitThumbFailed,
  finishThumbnailBackfill,
} from "./clip-media-store"
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
import type { MediaCompletion, MediaRow } from "./media-store"

export async function runThumbnailBackfill(
  id: string,
  row: MediaRow,
  runId: string,
  signal: AbortSignal,
  completion: MediaCompletion,
): Promise<void> {
  await withMediaRunWorkspace(
    { id, runId, row, cleanupLabel: "thumbnail" },
    async (workspace) => {
      const media = await materializeEffectiveMedia(id, row, runId, {
        workDir: workspace.workDir,
        signal,
      })
      await ensureStillPresent(id, runId, signal)

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
        if (!(await commitThumbFailed(id, runId, completion))) {
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
      if (!(await commitThumb(id, runId, thumb))) {
        throw abortMediaProcessing()
      }
      workspace.retainedKeys.add(thumb.thumbKey)
      if (!(await finishThumbnailBackfill(id, runId, completion))) {
        throw abortMediaProcessing()
      }
      void publishClipUpsert(row.authorId, id)
    },
  )
}
