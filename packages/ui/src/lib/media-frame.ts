export const CLIP_MEDIA_BACKGROUND_CLASS = "bg-[oklch(12%_0.01_250)]"

export const CLIP_MEDIA_VIEWPORT_CLASS = `relative aspect-video overflow-hidden ${CLIP_MEDIA_BACKGROUND_CLASS}`

export const CLIP_MEDIA_CLASS = `absolute inset-0 size-full object-contain object-center ${CLIP_MEDIA_BACKGROUND_CLASS}`

export const CLIP_VIDEO_MEDIA_CLASS = `${CLIP_MEDIA_CLASS} [clip-path:inset(1px)]`
