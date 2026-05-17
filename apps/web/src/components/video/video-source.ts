import * as React from "react"

export type SourceSpec =
  | { kind: "url"; url: string }
  | { kind: "file"; file: File }

export function toSourceSpec(src: string | File): SourceSpec {
  return typeof src === "string"
    ? { kind: "url", url: src }
    : { kind: "file", file: src }
}

export function sourceSpecKey(spec: SourceSpec): string {
  return spec.kind === "url"
    ? `url:${spec.url}`
    : `file:${spec.file.name}:${spec.file.size}:${spec.file.lastModified}`
}

export function useMediaUrl(spec: SourceSpec): string | null {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (spec.kind === "url") {
      setObjectUrl(null)
      return
    }

    const url = URL.createObjectURL(spec.file)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [spec])

  return spec.kind === "url" ? spec.url : objectUrl
}

export function mediaErrorMessage(video: HTMLVideoElement | null): string {
  const error = video?.error
  switch (error?.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Video loading was aborted."
    case MediaError.MEDIA_ERR_NETWORK:
      return "Network error while loading the video."
    case MediaError.MEDIA_ERR_DECODE:
      return "The browser could not decode this video."
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "This video source is not supported by the browser."
    default:
      return "Video playback failed."
  }
}
