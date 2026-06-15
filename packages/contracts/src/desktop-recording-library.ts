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
  bookmarksMs: number[]
  width: number | null
  height: number | null
  description: string | null
  tags: string | null
  mentions: RecordingCaptureMention[]
  privacy: ClipPrivacy | null
  /** Server clip id this capture was published as, once an upload finished. */
  uploadedClipId: string | null
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
  /**
   * The single range to keep. Multi-segment sequences are rejected — cut and
   * reorder in the editor, whose render pipeline imports back into the
   * library for publishing.
   */
  segments: RecordingLibraryExportSegment[]
}

export interface RecordingLibraryMetaPatch {
  id: string
  title?: string
  gameName?: string | null
  gameIconUrl?: string | null
  description?: string | null
  tags?: string | null
  mentions?: RecordingCaptureMention[]
  privacy?: ClipPrivacy | null
  uploadedClipId?: string | null
}

export interface RecordingLibraryMetaUpdateResult {
  /** Current capture id after any filesystem move caused by the metadata edit. */
  id: string
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

export const RECORDING_LIBRARY_PROJECT_FILTER_IDS = [
  "none",
  "clean",
  "warm",
  "crisp",
  "punch",
  "mono",
] as const

export type RecordingLibraryProjectFilterId =
  (typeof RECORDING_LIBRARY_PROJECT_FILTER_IDS)[number]

export interface RecordingLibraryProject {
  tracks: RecordingLibraryProjectTrack[]
  clips: RecordingLibraryProjectClip[]
  transitions: RecordingLibraryProjectTransition[]
  /** Global visual filter applied to preview and rendered exports. */
  filterId?: RecordingLibraryProjectFilterId
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
  /**
   * The source capture's cached poster, when one exists; the web layer falls
   * back to capturing a frame from the exported file itself.
   */
  thumbUrl: string | null
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

/** Outcome of importing user-picked video files into the capture library. */
export interface RecordingLibraryFilesImportResult {
  /** Library capture ids of the files that were imported. */
  importedIds: string[]
  /** Files that could not be imported, with a human-readable reason. */
  failed: { fileName: string; error: string }[]
  /** True when the user dismissed the file picker without choosing files. */
  canceled: boolean
}

/** Ask the desktop shell to persist an uploaded clip into the local library. */
export interface RecordingLibraryDownloadRequest {
  /** Server clip id; doubles as the download's identity (one job per clip). */
  clipId: string
  title: string
  /** Absolute URL of the clip's source media on the connected server. */
  mediaUrl: string
  /** MIME type of the uploaded source; picks the saved file extension. */
  contentType: string | null
  sizeBytes: number | null
  durationMs: number | null
  width: number | null
  height: number | null
  gameName: string | null
}

export type RecordingLibraryDownloadStatus =
  | "downloading"
  | "completed"
  | "failed"

/** Live state of one clip download, pushed as "library-download" events. */
export interface RecordingLibraryDownload {
  clipId: string
  title: string
  status: RecordingLibraryDownloadStatus
  receivedBytes: number
  /** Null while the server hasn't reported a content length. */
  totalBytes: number | null
  error: string | null
  /** Library capture id of the saved file, set once completed. */
  libraryItemId: string | null
  startedAt: string
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
