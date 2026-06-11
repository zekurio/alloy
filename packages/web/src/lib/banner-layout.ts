export const APP_BANNER_HEIGHT_CLASS = "aspect-[4/1] min-h-[96px] max-h-[375px]"

export const PROFILE_BANNER_ASPECT = 4

/**
 * Strictly fixed banner aspect for the floating profile card and its settings
 * preview. Unlike `APP_BANNER_HEIGHT_CLASS` (which the game-detail header pins
 * with min/max heights), this stays a single locked ratio so the rendered
 * banner always matches the crop boundary exactly (crop output is 1500×375).
 */
export const PROFILE_BANNER_ASPECT_CLASS = "aspect-[4/1]"
