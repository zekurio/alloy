import { randomUUID } from "node:crypto"

import type {
  RecordingLibraryProject,
  RecordingLibraryProjectDraftSaveRequest,
  RecordingLibraryProjectDraftSaveResult,
} from "@/shared/ipc"

import {
  readCaptureManifest,
  writeCaptureManifest,
} from "./recording-library-manifest"

export function saveRecordingLibraryProjectDraft(
  request: RecordingLibraryProjectDraftSaveRequest,
): RecordingLibraryProjectDraftSaveResult {
  const manifest = readCaptureManifest()
  const id =
    request.id && manifest.projectDrafts[request.id]
      ? request.id
      : `draft-${randomUUID()}`
  const existing = manifest.projectDrafts[id]
  const now = new Date().toISOString()
  const title = request.title.trim() || "Untitled project"
  const project = request.project

  manifest.projectDrafts[id] = {
    id,
    title,
    project,
    thumbnailSourceId: draftThumbnailSourceId(project),
    durationMs: projectDurationMs(project),
    clipCount: project.clips.length,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  writeCaptureManifest(manifest)
  return { id }
}

export function deleteRecordingLibraryProjectDraft(id: string): void {
  const manifest = readCaptureManifest()
  if (!manifest.projectDrafts[id]) return
  delete manifest.projectDrafts[id]
  writeCaptureManifest(manifest)
}

function projectDurationMs(project: RecordingLibraryProject): number {
  return project.clips.reduce((max, clip) => {
    const durationMs = Math.max(0, clip.sourceEndMs - clip.sourceStartMs)
    return Math.max(max, clip.startMs + durationMs)
  }, 0)
}

function draftThumbnailSourceId(
  project: RecordingLibraryProject,
): string | null {
  return (
    [...project.clips].sort((a, b) => a.startMs - b.startMs)[0]?.sourceId ??
    null
  )
}
