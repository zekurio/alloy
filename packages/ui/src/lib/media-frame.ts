export const CLIP_MEDIA_BACKGROUND_CLASS = "bg-transparent"

export const CLIP_MEDIA_VIEWPORT_CLASS = `relative aspect-video overflow-hidden ${CLIP_MEDIA_BACKGROUND_CLASS}`

export const CLIP_MEDIA_CLASS =
  "absolute inset-0 size-full object-contain object-center"

// Rounds a media frame and everything stacked inside it (still + video) in one
// pass. A plain border-radius + overflow-hidden lets Chromium paint promoted
// video layers past the rounded corners; clipping the frame itself holds them in.
export const CLIP_MEDIA_ROUNDED_CLASS =
  "[clip-path:inset(0_round_var(--radius-md))]"

export const CLIP_VIDEO_MEDIA_CLASS = `${CLIP_MEDIA_CLASS} [clip-path:inset(1px)]`
