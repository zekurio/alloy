import type {
  RecordingCaptureKind,
  RecordingCaptureSource,
  RecordingGameGuess,
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
  collection: "Clips"
  kind: RecordingCaptureKind
  source: RecordingCaptureSource
  groupKey: string
  groupLabel: string
  gameName: string | null
  gameIconUrl: string | null
  gameGuess: RecordingGameGuess | null
  sizeBytes: number
  durationMs: number | null
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
   * The single range to keep. Multi-segment sequences are rejected.
   */
  segments: RecordingLibraryExportSegment[]
}

export interface RecordingLibraryMetaPatch {
  id: string
  title?: string
  gameName?: string | null
  gameIconUrl?: string | null
  gameGuess?: RecordingGameGuess | null
  description?: string | null
  tags?: string | null
  mentions?: RecordingCaptureMention[]
  privacy?: ClipPrivacy | null
  uploadedClipId?: string | null
}

export interface RecordingLibraryMetaUpdateResult {
  /** Stable capture id after the metadata edit. */
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

export interface RecordingLibraryImportResult {
  /** Library capture id of the imported file. */
  id: string
}

/** A user-picked video copied into the desktop shell's temporary import stage. */
export interface RecordingLibraryStagedImport {
  /** Opaque token used to either commit or discard the staged file. */
  id: string
  /** Original file name, shown so the user can confirm what they picked. */
  fileName: string
  /** Suggested clip title derived from the picked file name. */
  title: string
  sizeBytes: number
  durationMs: number | null
  width: number | null
  height: number | null
}

/** Metadata required before a staged import becomes a library capture. */
export interface RecordingLibraryCommitStagedImportRequest {
  id: string
  title: string
  gameName: string
  gameIconUrl: string | null
}

/** Outcome of staging user-picked video files before they enter the library. */
export interface RecordingLibraryFilesImportResult {
  /** Picked files copied into the temporary import stage. */
  staged: RecordingLibraryStagedImport[]
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
  totalSizeBytes: number
  latestAt: string
  items: RecordingLibraryItem[]
}

export interface RecordingLibrarySnapshot {
  outputFolder: string
  scannedAt: string
  totalCount: number
  totalSizeBytes: number
  items: RecordingLibraryItem[]
  groups: RecordingLibraryGroup[]
}
