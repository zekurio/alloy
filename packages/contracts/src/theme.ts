import { t } from "./schema"

export const THEME_MODES = ["system", "light", "dark"] as const
export type ThemeMode = (typeof THEME_MODES)[number]

/** Bundled ids such as `nord`, and custom ones such as `custom-1a2b3c:dark`. */
const ThemeVariantIdSchema = t.string().regex(/^[a-z0-9][a-z0-9:-]{0,79}$/)

/**
 * The theme choice that follows a user across devices: the mode, the theme
 * shown in each appearance, and the personal accent of Alloy's base themes.
 * Custom theme colors stay on the device that made them.
 */
export const SyncedThemePreferencesSchema = t.object({
  mode: t.enum(THEME_MODES),
  light: ThemeVariantIdSchema,
  dark: ThemeVariantIdSchema,
  accent: t
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .nullable(),
})

export type SyncedThemePreferences = t.infer<
  typeof SyncedThemePreferencesSchema
>
