import {
  type ClipRenditionRef,
  clipMasterPlaylistUrl,
  clipRenditionFileUrl,
} from "@alloy/api"

import type { HlsPlayback } from "@/components/video/video-media-engine"
import { apiOrigin } from "@/lib/env"

/**
 * HLS playback config over a clip's committed renditions. Rendition files are
 * single-file fMP4s built for byte-range HLS — progressive playback of them
 * stalls in Chromium, so any player showing a rendition-backed clip should
 * pass this and keep the /stream URL only as the pre-rendition fallback.
 */
export function clipHlsPlayback(
  clipId: string,
  renditions: ClipRenditionRef[],
  playbackVersion: string | null | undefined,
  selected: { name: string; height: number; fps: number } | null = null,
): HlsPlayback | null {
  if (renditions.length === 0) return null
  return {
    masterUrl: clipMasterPlaylistUrl(
      clipId,
      apiOrigin(),
      playbackVersion ?? undefined,
    ),
    selected,
    renditionUrls: Object.fromEntries(
      renditions.map((rendition) => [
        rendition.name,
        clipRenditionFileUrl(
          clipId,
          rendition.name,
          apiOrigin(),
          rendition.version,
        ),
      ]),
    ),
  }
}
