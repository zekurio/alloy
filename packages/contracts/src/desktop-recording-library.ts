import type {
  RecordingCaptureKind,
  RecordingCaptureSource,
} from "./desktop-recording-types"
import type { ClipPrivacy } from "./shared"

/** Minimal user summary persisted with capture drafts to rehydrate pickers. */
export interface RecordingCaptureMention {
  id: string
  username: string
  displayUsername: string
  image: string | null
}

export interface RecordingLibraryItem {
  id: string
  title: string
  filename: string
  fileName: string
  mediaUrl: string
  thumbnailUrl: string | null
  /** Evenly spaced editor-timeline filmstrip frames (empty for screenshots). */
  filmstripFrameUrls: string[]
  thumbBlurHash: string | null
  collection: "Clips" | "Sessions" | "Screenshots"
  kind: RecordingCaptureKind
  source: RecordingCaptureSource
  groupKey: string
  groupLabel: string
  gameName: string | null
  gameIconUrl: string | null
  sizeBytes: number
  durationMs: number | null
  width: number | null
  height: number | null
  description: string | null
  tags: string | null
  mentions: RecordingCaptureMention[]
  privacy: ClipPrivacy | null
  createdAt: string
  modifiedAt: string
}

/** One source range of an edited sequence, in playback order. */
export interface RecordingLibraryExportSegment {
  startMs: number
  endMs: number
}

export interface RecordingLibraryExportRequest {
  id: string
  /** Ordered segments to keep; multiple segments concatenate on export. */
  segments: RecordingLibraryExportSegment[]
}

export interface RecordingLibraryMetaPatch {
  id: string
  title?: string
  description?: string | null
  tags?: string | null
  mentions?: RecordingCaptureMention[]
  privacy?: ClipPrivacy | null
}

export interface RecordingLibraryProjectTrack {
  id: string
  label: string
}

export interface RecordingLibraryProjectClip {
  id: string
  trackId: string
  sourceId: string
  sourceDurationMs: number
  sourceStartMs: number
  sourceEndMs: number
  startMs: number
  label: string
}

export interface RecordingLibraryProjectTransition {
  id: string
  type: "crossfade"
  leftClipId: string
  rightClipId: string
  durationMs: number
}

export interface RecordingLibraryProject {
  tracks: RecordingLibraryProjectTrack[]
  clips: RecordingLibraryProjectClip[]
  transitions: RecordingLibraryProjectTransition[]
}

export interface RecordingLibraryProjectDraft {
  id: string
  title: string
  project: RecordingLibraryProject
  thumbnailSourceId: string | null
  durationMs: number
  clipCount: number
  createdAt: string
  updatedAt: string
}

export interface RecordingLibraryProjectDraftSaveRequest {
  id?: string | null
  title: string
  project: RecordingLibraryProject
}

export interface RecordingLibraryProjectDraftSaveResult {
  id: string
}

export interface RecordingLibraryExport {
  id: string
  mediaUrl: string
  fileName: string
  contentType: string
  sizeBytes: number
  durationMs: number
  width: number | null
  height: number | null
  thumbBlurHash: string | null
}

/** A rendered video to add to the capture library (from the editor). */
export interface RecordingLibraryImportRequest {
  /** Suggested file name (sanitized and uniquified on write); ".mp4" added. */
  fileName: string
  data: Uint8Array
  durationMs: number
  width: number | null
  height: number | null
}

export interface RecordingLibraryImportResult {
  /** Library capture id of the imported file. */
  id: string
}

export interface RecordingLibraryGroup {
  key: string
  label: string
  kind: "game" | "desktop"
  iconUrl: string | null
  totalCount: number
  clipCount: number
  sessionCount: number
  screenshotCount: number
  totalSizeBytes: number
  latestAt: string
  items: RecordingLibraryItem[]
}

export interface RecordingLibrarySnapshot {
  outputFolder: string
  screenshotFolder: string
  scannedAt: string
  totalCount: number
  totalSizeBytes: number
  items: RecordingLibraryItem[]
  groups: RecordingLibraryGroup[]
  projectDrafts: RecordingLibraryProjectDraft[]
}
