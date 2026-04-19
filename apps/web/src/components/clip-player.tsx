import { clipStreamUrl, clipThumbnailUrl } from "../lib/clips-api"
import { VideoPlayer } from "./video-player"

/**
 * ClipPlayer — the surface that renders inside the clip dialog.
 *
 * This is now a thin wrapper around `VideoPlayer` (the shared custom
 * player). It's kept as its own component so the dialog's call site and
 * future surfaces (embed, share page, profile preview) can ask for a
 * clip by id without threading the stream + poster URL builders.
 *
 * Previously the player doubled as a mock preview with overlaid game /
 * quality badges. Those are gone — the mock surfaces now render the card
 * only, and once a user clicks in, they're on a real clip id and we play
 * the real stream. See `VideoPlayer` for the chrome itself.
 */
interface ClipPlayerProps {
  /** Real clip id — drives both the stream URL and the default poster. */
  clipId: string
  /**
   * Optional explicit thumbnail URL. When omitted we fall back to
   * `/api/clips/:id/thumbnail` — handing a pre-built URL through lets the
   * card's thumbnail request be reused as the poster without a second
   * round trip.
   */
  thumbnail?: string
  className?: string
}

function ClipPlayer({ clipId, thumbnail, className }: ClipPlayerProps) {
  const poster = thumbnail ?? clipThumbnailUrl(clipId)
  return (
    <VideoPlayer
      src={clipStreamUrl(clipId)}
      poster={poster}
      className={className}
    />
  )
}

export { ClipPlayer, type ClipPlayerProps }
