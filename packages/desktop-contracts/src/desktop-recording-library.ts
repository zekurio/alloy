import type { ClipPrivacy } from "@alloy/primitives"

import type {
  RecordingCaptureKind,
  RecordingCaptureSource,
  RecordingGameGuess,
} from "./desktop-recording-types"

/** Minimal user summary persisted with capture drafts to rehydrate pickers. */
export interface RecordingCaptureMention {
  id: string
  username: string
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
  collection: "Clips" | "Screenshots"
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
  /** Server/client clip id this capture is being or has been published as. */
  uploadedClipId: string | null
  /**
   * Start of the range of this recording that was uploaded as the clip's
   * server source; that position is time zero of the server source. Null for
   * downloads and for links without a recorded range.
   */
  uploadedClipSourceStartMs: number | null
  /** Length of the uploaded range within this recording. */
  uploadedClipSourceDurationMs: number | null
  /**
   * Server media version of this file's bytes, recorded when the file was
   * downloaded. Equals `ClipRow.sourceVersion` while the server still
   * publishes those bytes. Null for recordings.
   */
  uploadedClipMediaVersion: string | null
  /**
   * Persisted non-destructive trim range in source time, or null when the
   * capture is untrimmed. The source file is never rewritten; exports and
   * publishes derive the cut from these bounds.
   */
  trimStartMs: number | null
  trimEndMs: number | null
  createdAt: string
  modifiedAt: string
}

export function contentTypeForFile(fileName: string): string {
  switch (fileNameExtension(fileName)) {
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".webp":
      return "image/webp"
    case ".mp4":
      return "video/mp4"
    case ".mov":
      return "video/quicktime"
    case ".mkv":
      return "video/x-matroska"
    case ".webm":
      return "video/webm"
    default:
      return "application/octet-stream"
  }
}

function fileNameExtension(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).at(-1) ?? ""
  const extensionIndex = baseName.lastIndexOf(".")
  if (extensionIndex <= 0) return ""
  return baseName.slice(extensionIndex).toLowerCase()
}

export interface RecordingLibraryExportRequest {
  id: string
  /**
   * The single source range to keep, in playback order. Multi-segment
   * sequences are rejected.
   */
  segments: Array<{ startMs: number; endMs: number }>
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
  /** Changing the linked clip clears the recorded range and media version. */
  uploadedClipId?: string | null
  /** Start of the uploaded range within the recording. */
  uploadedClipSourceStartMs?: number | null
  /** Length of the uploaded range within the recording. */
  uploadedClipSourceDurationMs?: number | null
}

/**
 * Persists or clears a capture's non-destructive trim range. Both bounds
 * null clears the trim; otherwise both must be integers with
 * `0 <= trimStartMs < trimEndMs`.
 */
export interface RecordingLibraryTrimUpdate {
  id: string
  trimStartMs: number | null
  trimEndMs: number | null
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
  /**
   * Range of the capture this export contains, in capture time. A whole-file
   * export reports 0 and the capture's duration.
   */
  sourceStartMs: number
  sourceEndMs: number
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
