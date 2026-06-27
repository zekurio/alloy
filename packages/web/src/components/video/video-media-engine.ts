import { useEffect, useState } from "react"

import { createObjectUrl, revokeObjectUrl } from "@/lib/object-url"

import type { SourceSpec } from "./video-source"

export function useMediaEngine(spec: SourceSpec): { src: string | null } {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  // Object URL lifecycle for local File sources.
  useEffect(() => {
    if (spec.kind !== "file") {
      setObjectUrl(null)
      return
    }
    const url = createObjectUrl(spec.file, "media source URL")
    setObjectUrl(url)
    return () => revokeObjectUrl(url, "media source URL")
  }, [spec])

  return {
    src: spec.kind === "url" ? spec.url : objectUrl,
  }
}
