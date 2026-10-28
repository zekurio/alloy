import { t } from "./schema"

export const THEME_MODES = ["system", "light", "dark"] as const
export type ThemeMode = (typeof THEME_MODES)[number]

export const THEME_APPEARANCES = ["light", "dark"] as const
export type ThemeAppearance = (typeof THEME_APPEARANCES)[number]

/** Lowercase `#rrggbb`, the only form themes store colors in. */
export const HexColorSchema = t.string().regex(/^#[0-9a-f]{6}$/)

/** Bundled ids such as `nord`, and custom ones such as `custom-1a2b3c:dark`. */
const ThemeVariantIdSchema = t.string().regex(/^[a-z0-9][a-z0-9:-]{0,79}$/)

/** An accent per appearance for the Alloy theme; null keeps Alloy's own. */
export const ThemeAccentsSchema = t.object({
  light: HexColorSchema.nullable(),
  dark: HexColorSchema.nullable(),
})

export type ThemeAccents = t.infer<typeof ThemeAccentsSchema>

export const NO_THEME_ACCENTS: Readonly<ThemeAccents> = Object.freeze({
  light: null,
  dark: null,
})

/**
 * The theme choice that follows a user across devices: the mode, and the
 * theme shown in each appearance.
 */
export const SyncedThemePreferencesSchema = t.object({
  mode: t.enum(THEME_MODES),
  light: ThemeVariantIdSchema,
  dark: ThemeVariantIdSchema,
})

export type SyncedThemePreferences = t.infer<
  typeof SyncedThemePreferencesSchema
>

export const THEME_NAME_MAX_LENGTH = 48
export const THEME_VARIANT_NAME_MAX_LENGTH = 32
export const MAX_USER_THEMES = 50
/** Room for a light variant and several dark ones, as Catppuccin has. */
export const MAX_THEME_VARIANTS = 8

/**
 * Made by the client, so saving is an idempotent PUT and the synced theme
 * choice can point at a theme by the id it was created with.
 */
export const UserThemeIdSchema = t.string().regex(/^custom-[0-9a-f]{8,32}$/)

/**
 * One appearance of a custom theme: a color per role. Every role is optional
 * because clients derive the missing ones, so a role added later doesn't
 * invalidate themes saved before it existed.
 */
export const UserThemeColorsSchema = t
  .object({
    background: HexColorSchema.optional(),
    surface: HexColorSchema.optional(),
    surfaceRaised: HexColorSchema.optional(),
    surfaceSunken: HexColorSchema.optional(),
    input: HexColorSchema.optional(),
    border: HexColorSchema.optional(),
    borderStrong: HexColorSchema.optional(),
    borderEmphasis: HexColorSchema.optional(),
    text: HexColorSchema.optional(),
    textMuted: HexColorSchema.optional(),
    textDim: HexColorSchema.optional(),
    textFaint: HexColorSchema.optional(),
    accent: HexColorSchema.optional(),
    accentForeground: HexColorSchema.optional(),
    accentHover: HexColorSchema.optional(),
    accentActive: HexColorSchema.optional(),
    accentDim: HexColorSchema.optional(),
    success: HexColorSchema.optional(),
    warning: HexColorSchema.optional(),
    danger: HexColorSchema.optional(),
    info: HexColorSchema.optional(),
    live: HexColorSchema.optional(),
  })
  .strict()

export type UserThemeColors = t.infer<typeof UserThemeColorsSchema>

/** The roles a theme colors, in the order editors list them. */
export const THEME_COLOR_ROLES = [
  "background",
  "surface",
  "surfaceRaised",
  "surfaceSunken",
  "input",
  "border",
  "borderStrong",
  "borderEmphasis",
  "text",
  "textMuted",
  "textDim",
  "textFaint",
  "accent",
  "accentForeground",
  "accentHover",
  "accentActive",
  "accentDim",
  "success",
  "warning",
  "danger",
  "info",
  "live",
] as const satisfies readonly (keyof UserThemeColors)[]
export type ThemeColorRole = (typeof THEME_COLOR_ROLES)[number]

/**
 * Made by the client and unique within its theme. The synced theme choice
 * points at a variant as `<theme id>:<variant id>`.
 */
export const UserThemeVariantIdSchema = t.string().regex(/^[a-z0-9]{1,16}$/)

/** One palette of a custom theme, made for light or dark mode. */
export const UserThemeVariantSchema = t.object({
  id: UserThemeVariantIdSchema,
  /** Null names it by its appearance, such as "Dark" or "Dark 2". */
  name: t.string().trim().min(1).max(THEME_VARIANT_NAME_MAX_LENGTH).nullable(),
  appearance: t.enum(THEME_APPEARANCES),
  colors: UserThemeColorsSchema,
})

export type UserThemeVariant = t.infer<typeof UserThemeVariantSchema>

/** A custom theme as saved: one or more variants, in the order they show. */
export const UserThemeInputSchema = t.object({
  name: t.string().trim().min(1).max(THEME_NAME_MAX_LENGTH),
  variants: t
    .array(UserThemeVariantSchema)
    .min(1)
    .max(MAX_THEME_VARIANTS)
    .refine(
      (variants) =>
        new Set(variants.map((variant) => variant.id)).size === variants.length,
      "variant ids must be unique",
    ),
  /** Saved from the guided editor, which only asks for background and accent. */
  guided: t.boolean(),
})

export type UserThemeInput = t.infer<typeof UserThemeInputSchema>

export const UserThemeSchema = UserThemeInputSchema.extend({
  id: UserThemeIdSchema,
})

export type UserTheme = t.infer<typeof UserThemeSchema>

export const UserThemeListResponseSchema = t.object({
  themes: t.array(UserThemeSchema),
})

export const UserThemeResponseSchema = t.object({ theme: UserThemeSchema })
