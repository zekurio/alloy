import type { SettingsCategoryId } from "@/components/routes/settings/settings-search"

/**
 * Page for "settings, no page in particular", at `/settings`. A phone shows
 * the menu of pages for it; wider layouts fall through to the first page.
 */
export const SETTINGS_OVERVIEW = "overview"

export type SettingsPage = SettingsCategoryId | typeof SETTINGS_OVERVIEW

/** The address of a settings page. A page id is its path under /settings/. */
export function settingsAddress(page: string) {
  return {
    to: "/settings/$",
    params: { _splat: page === SETTINGS_OVERVIEW ? "" : page },
  } as const
}

/** The page a settings address names. */
export function settingsPageFromSplat(splat: string | undefined): string {
  return splat?.replace(/\/+$/, "") || SETTINGS_OVERVIEW
}

/**
 * Opens a settings page over the current page. The real location stays on
 * that page, path, search and hash, and carries the settings page in its
 * history state, while the address bar shows the page's settings address.
 * Dropping the state and the mask is all it takes to close it again.
 */
export function settingsOverPage(page: string, fromOverview = false) {
  return {
    to: ".",
    search: true,
    hash: true,
    state: fromOverview
      ? { settingsPage: page, settingsFromOverview: true }
      : { settingsPage: page },
    mask: settingsAddress(page),
    resetScroll: false,
  } as const
}
