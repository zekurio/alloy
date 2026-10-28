import {
  isObjectRecord,
  isStringValue,
  MAX_THEME_VARIANTS,
  MAX_USER_THEMES,
  THEME_NAME_MAX_LENGTH,
  THEME_VARIANT_NAME_MAX_LENGTH,
  UserThemeIdSchema,
  UserThemeVariantIdSchema,
  type ContractJsonInput,
  type ContractJsonValue,
  type UserTheme,
  type UserThemeInput,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { createLocalStorageDriver } from "@alloy/ui/lib/local-storage"
import {
  canonicalThemeColors,
  completeThemeColors,
  defaultThemeBackground,
  opaqueThemeColor,
  THEME_APPEARANCES,
  THEME_COLOR_ROLES,
  themeColorsFrom,
  type ThemeAppearance,
  type ThemeColorOverrides,
  type ThemeColorRole,
  type ThemeColors,
} from "@alloy/ui/lib/theme-colors"
import type { ThemeFamily, ThemeVariant } from "@alloy/ui/lib/theme-presets"
import { readVsCodeTheme } from "@alloy/ui/lib/theme-vscode"

/**
 * User-made themes: saved to the account, and exported and imported as small
 * JSON files. The browser keeps a copy of the account's list so the first
 * frame and the settings page don't wait for the server. Every stored color is
 * a canonical `#rrggbb`, which keeps the CSS written from them free of
 * anything but colors.
 */

export const CUSTOM_THEMES_STORAGE_KEY = "alloy.themes"
const THEME_FILE_VERSION = 2
const THEME_SOURCE_MAX_BYTES = 256 * 1024

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/

export interface CustomThemeVariant {
  /** Unique within its theme; the theme choice stores `<theme id>:<id>`. */
  id: string
  /** Null names it by its appearance, such as "Dark" or "Dark 2". */
  name: string | null
  appearance: ThemeAppearance
  colors: ThemeColors
}

export interface ThemeDraft {
  name: string
  /** At least one, in the order the theme's card shows them. */
  variants: CustomThemeVariant[]
}

export interface CustomTheme extends ThemeDraft {
  id: string
  /** Saved from the guided editor, which only asks for background and accent. */
  guided: boolean
}

export interface ThemeSource {
  text: string
  /** File name, used when the theme doesn't carry its own. */
  name: string | null
}

/** The exported file: versioned so the format can grow. */
interface ThemeFile {
  version: typeof THEME_FILE_VERSION
  name: string
  variants: ThemeFileVariant[]
}

interface ThemeFileVariant {
  name?: string
  appearance: ThemeAppearance
  colors: ThemeColors
}

export interface ThemeImport {
  themes: ThemeDraft[]
  errors: string[]
}

const customThemeStorage = createLocalStorageDriver(
  CUSTOM_THEMES_STORAGE_KEY,
  normalizeCustomThemes,
)

export function readCustomThemes(): readonly CustomTheme[] {
  return customThemeStorage.read()
}

export function refreshCustomThemes(): readonly CustomTheme[] {
  return customThemeStorage.refresh()
}

export function writeCustomThemes(
  themes: readonly CustomTheme[],
): readonly CustomTheme[] {
  return customThemeStorage.write([...themes])
}

/** The account's copy of a theme, with any roles it predates derived. */
export function customThemeFromAccount(theme: UserTheme): CustomTheme {
  return {
    id: theme.id,
    name: theme.name,
    variants: theme.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      appearance: variant.appearance,
      colors: completeThemeColors(variant.appearance, variant.colors),
    })),
    guided: theme.guided,
  }
}

export function accountThemeInput(theme: CustomTheme): UserThemeInput {
  return {
    name: theme.name,
    variants: theme.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      appearance: variant.appearance,
      colors: canonicalThemeColors(variant.colors),
    })),
    guided: theme.guided,
  }
}

export function newCustomThemeId(): string {
  return `custom-${randomHex(6)}`
}

/** A variant id that none of `taken` has yet. */
export function newThemeVariantId(
  taken: readonly CustomThemeVariant[] = [],
): string {
  for (;;) {
    const id = randomHex(4)
    if (!taken.some((variant) => variant.id === id)) return id
  }
}

/**
 * The variant's name, or its appearance when it has none. Unnamed variants
 * of the same appearance are numbered from the second on: "Dark", "Dark 2".
 */
export function customVariantLabel(
  variants: readonly CustomThemeVariant[],
  variant: CustomThemeVariant,
): string {
  const name = variant.name?.trim()
  if (name) return name
  const appearance = variant.appearance === "light" ? t("Light") : t("Dark")
  const number =
    variants
      .filter(
        (candidate) =>
          !candidate.name?.trim() &&
          candidate.appearance === variant.appearance,
      )
      .findIndex((candidate) => candidate.id === variant.id) + 1
  return number > 1
    ? t("{appearance} {number}", { appearance, number })
    : appearance
}

export function customThemeFamily(theme: CustomTheme): ThemeFamily {
  return {
    id: theme.id,
    label: theme.name,
    variants: theme.variants.map((variant): ThemeVariant => ({
      id: `${theme.id}:${variant.id}`,
      label: customVariantLabel(theme.variants, variant),
      appearance: variant.appearance,
      colors: variant.colors,
    })),
    custom: true,
  }
}

export function serializeThemeFile(theme: ThemeDraft): string {
  const file: ThemeFile = {
    version: THEME_FILE_VERSION,
    name: theme.name,
    variants: theme.variants.map(themeFileVariant),
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

/** Unnamed variants leave the name out, so it reads first when present. */
function themeFileVariant(variant: CustomThemeVariant): ThemeFileVariant {
  const { appearance, colors } = variant
  return variant.name
    ? { name: variant.name, appearance, colors }
    : { appearance, colors }
}

/**
 * Reads Alloy theme files and VS Code color themes. Light and dark files of
 * the same VS Code theme ("Foo Light", "Foo Dark") merge into one theme.
 */
export function importThemeSources(
  sources: readonly ThemeSource[],
): ThemeImport {
  const themes: ThemeDraft[] = []
  const errors: string[] = []
  for (const source of sources) {
    const result = parseThemeSource(source)
    if (isStringValue(result)) {
      errors.push(
        source.name
          ? t("{file}: {error}", { file: source.name, error: result })
          : result,
      )
    } else {
      themes.push(result)
    }
  }
  return { themes: pairThemeDrafts(themes), errors }
}

/** Gives a theme name that doesn't collide with `taken`, adding " 2", " 3", … */
export function uniqueThemeName(
  name: string,
  taken: readonly string[],
): string {
  const names = new Set(taken.map((candidate) => candidate.toLowerCase()))
  if (!names.has(name.toLowerCase())) return name
  for (let index = 2; ; index += 1) {
    const suffix = ` ${index}`
    const candidate = `${name.slice(0, THEME_NAME_MAX_LENGTH - suffix.length)}${suffix}`
    if (!names.has(candidate.toLowerCase())) return candidate
  }
}

function parseThemeSource(source: ThemeSource): ThemeDraft | string {
  if (new Blob([source.text]).size > THEME_SOURCE_MAX_BYTES) {
    return t("Theme files can be at most 256 KB.")
  }

  let json: ContractJsonInput
  try {
    json = JSON.parse(stripJsonComments(source.text))
  } catch {
    return t("This isn't valid JSON.")
  }
  if (!isObjectRecord(json)) return t("Expected a theme object.")

  const fallbackName = source.name
    ? source.name.replace(/\.jsonc?$/i, "").replace(/[-_.]+/g, " ")
    : t("Imported theme")
  if (json.version !== undefined) return parseAlloyThemeFile(json)
  if (isObjectRecord(json.colors) || Array.isArray(json.tokenColors)) {
    const theme = readVsCodeTheme(json)
    if (isStringValue(theme)) return theme
    return {
      name: (theme.name ?? fallbackName).slice(0, THEME_NAME_MAX_LENGTH),
      variants: [
        {
          id: newThemeVariantId(),
          name: null,
          appearance: theme.appearance,
          colors: theme.colors,
        },
      ],
    }
  }
  return t("Expected an Alloy or VS Code theme.")
}

function parseAlloyThemeFile(
  json: Record<string, ContractJsonValue>,
): ThemeDraft | string {
  if (json.version !== THEME_FILE_VERSION) {
    return t("Unsupported theme file version.")
  }
  const name = isStringValue(json.name) ? json.name.trim() : ""
  if (!name || name.length > THEME_NAME_MAX_LENGTH) {
    return t("A theme needs a name of 1 to {max} characters.", {
      max: THEME_NAME_MAX_LENGTH,
    })
  }

  const variants = parseThemeVariants(json.variants)
  if (isStringValue(variants)) return variants
  if (variants.length === 0) return t("A theme needs light or dark colors.")
  if (variants.length > MAX_THEME_VARIANTS) {
    return t("A theme can have at most {max} variants.", {
      max: MAX_THEME_VARIANTS,
    })
  }
  return { name, variants }
}

function parseThemeVariants(
  value: ContractJsonValue | undefined,
): CustomThemeVariant[] | string {
  if (!Array.isArray(value)) return t("Expected a list of variants.")
  const variants: CustomThemeVariant[] = []
  for (const entry of value) {
    if (!isObjectRecord(entry)) return t("Expected a list of variants.")
    const appearance = THEME_APPEARANCES.find(
      (candidate) => candidate === entry.appearance,
    )
    if (!appearance)
      return t('A variant\'s appearance must be "light" or "dark".')
    const colors = parseThemeColors(appearance, entry.colors ?? {})
    if (isStringValue(colors)) return colors
    variants.push({
      id: newThemeVariantId(variants),
      name: variantName(entry.name),
      appearance,
      colors,
    })
  }
  return variants
}

/** A trimmed name that fits, or null for one that's missing or blank. */
function variantName(value: ContractJsonValue | undefined): string | null {
  if (!isStringValue(value)) return null
  return value.trim().slice(0, THEME_VARIANT_NAME_MAX_LENGTH).trim() || null
}

function parseThemeColors(
  appearance: ThemeAppearance,
  value: ContractJsonValue,
): ThemeColors | string {
  if (!isObjectRecord(value)) {
    return t("Expected {appearance} colors to be an object.", { appearance })
  }

  const background = value.background
  const backgroundColor = isStringValue(background)
    ? opaqueThemeColor(background, defaultThemeBackground(appearance))
    : defaultThemeBackground(appearance)
  if (!backgroundColor) {
    return t('"{value}" isn\'t a color.', { value: String(background) })
  }

  const overrides: ThemeColorOverrides = {}
  for (const [key, color] of Object.entries(value)) {
    const role = THEME_COLOR_ROLES.find((candidate) => candidate === key)
    if (!role) return t('Unknown theme color "{key}".', { key })
    const normalized = isStringValue(color)
      ? opaqueThemeColor(color, backgroundColor)
      : null
    if (!normalized) {
      return t('"{value}" isn\'t a color.', { value: String(color) })
    }
    overrides[role] = normalized
  }
  return completeThemeColors(appearance, overrides)
}

function pairThemeDrafts(drafts: readonly ThemeDraft[]): ThemeDraft[] {
  const paired: ThemeDraft[] = []
  for (const draft of drafts) {
    const variant = singleVariant(draft)
    const baseName = variant ? stripAppearanceSuffix(draft.name) : null
    const partner =
      variant && baseName
        ? paired.find((candidate) => {
            const candidateVariant = singleVariant(candidate)
            return (
              candidateVariant !== null &&
              candidateVariant.appearance !== variant.appearance &&
              stripAppearanceSuffix(candidate.name)?.toLowerCase() ===
                baseName.toLowerCase()
            )
          })
        : undefined
    if (variant && baseName && partner) {
      const added = partner.variants.some(
        (candidate) => candidate.id === variant.id,
      )
        ? { ...variant, id: newThemeVariantId(partner.variants) }
        : variant
      // Light first, as the bundled themes list theirs.
      const variants = [...partner.variants, added]
      partner.name = baseName
      partner.variants = THEME_APPEARANCES.flatMap((appearance) =>
        variants.filter((candidate) => candidate.appearance === appearance),
      )
    } else {
      paired.push({ ...draft })
    }
  }
  return paired
}

function singleVariant(draft: ThemeDraft): CustomThemeVariant | null {
  const [variant, ...rest] = draft.variants
  return variant && rest.length === 0 ? variant : null
}

function stripAppearanceSuffix(name: string): string | null {
  const stripped = name.replace(/[\s\-_(]*(light|dark)\)?$/i, "").trim()
  return stripped && stripped !== name ? stripped : null
}

/**
 * VS Code themes are JSONC: comments and trailing commas are allowed. Strings
 * are copied verbatim, so `//` or `,]` inside a value survives.
 */
function stripJsonComments(text: string): string {
  let output = ""
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      let end = index + 1
      while (end < text.length && text[end] !== '"') {
        end += text[end] === "\\" ? 2 : 1
      }
      output += text.slice(index, end + 1)
      index = end + 1
      continue
    }
    const afterComment = skipJsonComment(text, index)
    if (afterComment !== index) {
      index = afterComment
      continue
    }
    if (char === ",") {
      // A trailing comma: the next token closes the object or array.
      const closer = text[skipJsonSpace(text, index + 1)]
      if (closer !== "}" && closer !== "]") output += char
    } else {
      output += char
    }
    index += 1
  }
  return output
}

/** Where the text continues after whitespace and comments from `index`. */
function skipJsonSpace(text: string, index: number): number {
  let next = index
  while (next < text.length) {
    const afterComment = skipJsonComment(text, next)
    if (afterComment !== next) next = afterComment
    else if (/\s/.test(text[next] ?? "")) next += 1
    else break
  }
  return next
}

/** Where the text continues after a comment at `index`, or `index` itself. */
function skipJsonComment(text: string, index: number): number {
  if (text[index] !== "/") return index
  if (text[index + 1] === "/") {
    const end = text.indexOf("\n", index)
    return end === -1 ? text.length : end
  }
  if (text[index + 1] === "*") {
    const end = text.indexOf("*/", index + 2)
    return end === -1 ? text.length : end + 2
  }
  return index
}

function normalizeCustomThemes(value: ContractJsonInput): CustomTheme[] {
  if (!Array.isArray(value)) return []
  const themes: CustomTheme[] = []
  for (const entry of value.slice(0, MAX_USER_THEMES)) {
    const theme = normalizeCustomTheme(entry)
    if (theme && !themes.some((existing) => existing.id === theme.id)) {
      themes.push(theme)
    }
  }
  return themes
}

function normalizeCustomTheme(value: ContractJsonInput): CustomTheme | null {
  if (!isObjectRecord(value)) return null
  const { id, name } = value
  if (!isStringValue(id) || !UserThemeIdSchema.safeParse(id).success) {
    return null
  }
  if (!isStringValue(name) || !name.trim()) return null

  if (!Array.isArray(value.variants)) return null
  const variants = normalizeStoredVariants(value.variants)
  if (variants.length === 0) return null
  return {
    id,
    name: name.trim().slice(0, THEME_NAME_MAX_LENGTH),
    variants,
    guided: value.guided === true,
  }
}

function normalizeStoredVariants(
  value: readonly ContractJsonValue[],
): CustomThemeVariant[] {
  const variants: CustomThemeVariant[] = []
  for (const entry of value.slice(0, MAX_THEME_VARIANTS)) {
    if (!isObjectRecord(entry)) continue
    const { id } = entry
    const appearance = THEME_APPEARANCES.find(
      (candidate) => candidate === entry.appearance,
    )
    const colors = normalizeStoredColors(entry.colors)
    if (
      !isStringValue(id) ||
      !UserThemeVariantIdSchema.safeParse(id).success ||
      variants.some((existing) => existing.id === id) ||
      !appearance ||
      !colors
    ) {
      continue
    }
    variants.push({ id, name: variantName(entry.name), appearance, colors })
  }
  return variants
}

function normalizeStoredColors(value: ContractJsonValue): ThemeColors | null {
  if (!isObjectRecord(value)) return null
  const stored = (role: ThemeColorRole) => {
    const color = value[role]
    return isStringValue(color) && HEX_COLOR_RE.test(color) ? color : null
  }
  if (!THEME_COLOR_ROLES.every(stored)) return null
  return themeColorsFrom((role) => stored(role) ?? "")
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
}
