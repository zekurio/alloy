import { t } from "@alloy/i18n"
export type SourceSpec =
  | { kind: "url"; url: string }
  | { kind: "file"; file: File }
  | { kind: "hls"; url: string }

export function toSourceSpec(src: string | File): SourceSpec {
  return typeof src === "string"
    ? { kind: "url", url: src }
    : { kind: "file", file: src }
}

export function sourceSpecKey(spec: SourceSpec): string {
  switch (spec.kind) {
    case "url":
      return `url:${spec.url}`
    case "hls":
      return `hls:${spec.url}`
    case "file":
      return `file:${spec.file.name}:${spec.file.size}:${spec.file.lastModified}`
  }
}

export function mediaErrorMessage(video: HTMLVideoElement | null): string {
  const error = video?.error
  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return t("Video loading was aborted.")
    case MediaError.MEDIA_ERR_NETWORK:
      return t("Network error while loading the video.")
    case MediaError.MEDIA_ERR_DECODE:
      return t("The browser could not decode this video.")
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return t("This video source is not supported by the browser.")
    default:
      return t("Video playback failed.")
  }
}

export function isInterruptedPlayRequest(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    cause.name === "AbortError"
  )
}
