import {
  isObjectRecord,
  isStringValue,
  type ContractJsonInput,
  type ContractJsonValue,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { createLocalStorageDriver } from "@alloy/ui/lib/local-storage"
import {
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
 * User-made themes: stored per browser, exported and imported as small JSON
 * files. Every stored color is a canonical `#rrggbb`, which keeps the CSS
 * written from them free of anything but colors.
 */

export const CUSTOM_THEMES_STORAGE_KEY = "alloy.themes"
export const THEME_NAME_MAX_LENGTH = 48
const THEME_FILE_VERSION = 1
const THEME_SOURCE_MAX_BYTES = 256 * 1024
const MAX_CUSTOM_THEMES = 100

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/
const CUSTOM_THEME_ID_RE = /^custom-[0-9a-f]{8,32}$/

export interface ThemeDraft {
  name: string
  light: ThemeColors | null
  dark: ThemeColors | null
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
  light?: ThemeColors
  dark?: ThemeColors
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

export function newCustomThemeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return `custom-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

function customThemeVariantId(
  themeId: string,
  appearance: ThemeAppearance,
): string {
  return `${themeId}:${appearance}`
}

export function customThemeFamily(theme: CustomTheme): ThemeFamily {
  const variants = THEME_APPEARANCES.flatMap((appearance): ThemeVariant[] => {
    const colors = theme[appearance]
    return colors
      ? [
          {
            id: customThemeVariantId(theme.id, appearance),
            label: theme.name,
            appearance,
            colors,
          },
        ]
      : []
  })
  return {
    id: theme.id,
    label: theme.name,
    variants,
    followsAccent: false,
    custom: true,
  }
}

export function serializeThemeFile(theme: ThemeDraft): string {
  const file: ThemeFile = { version: THEME_FILE_VERSION, name: theme.name }
  if (theme.light) file.light = theme.light
  if (theme.dark) file.dark = theme.dark
  return `${JSON.stringify(file, null, 2)}\n`
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
      light: theme.appearance === "light" ? theme.colors : null,
      dark: theme.appearance === "dark" ? theme.colors : null,
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

  const draft: ThemeDraft = { name, light: null, dark: null }
  for (const appearance of THEME_APPEARANCES) {
    const value = json[appearance]
    if (value === undefined) continue
    const colors = parseThemeColors(appearance, value)
    if (isStringValue(colors)) return colors
    draft[appearance] = colors
  }
  if (!draft.light && !draft.dark) {
    return t("A theme needs light or dark colors.")
  }
  return draft
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
    const appearance = singleAppearance(draft)
    const baseName = appearance ? stripAppearanceSuffix(draft.name) : null
    const partner =
      appearance && baseName
        ? paired.find((candidate) => {
            const candidateAppearance = singleAppearance(candidate)
            return (
              candidateAppearance !== null &&
              candidateAppearance !== appearance &&
              stripAppearanceSuffix(candidate.name)?.toLowerCase() ===
                baseName.toLowerCase()
            )
          })
        : undefined
    if (appearance && baseName && partner) {
      partner.name = baseName
      partner[appearance] = draft[appearance]
    } else {
      paired.push({ ...draft })
    }
  }
  return paired
}

function singleAppearance(draft: ThemeDraft): ThemeAppearance | null {
  if (draft.light && !draft.dark) return "light"
  if (draft.dark && !draft.light) return "dark"
  return null
}

function stripAppearanceSuffix(name: string): string | null {
  const stripped = name.replace(/[\s\-_(]*(light|dark)\)?$/i, "").trim()
  return stripped && stripped !== name ? stripped : null
}

/**
 * VS Code themes are JSONC: comments and trailing commas are allowed. Strings
 * are copied verbatim, so `//` inside a value survives.
 */
function stripJsonComments(text: string): string {
  let output = ""
  let index = 0
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (char === '"') {
      let end = index + 1
      while (end < text.length && text[end] !== '"') {
        end += text[end] === "\\" ? 2 : 1
      }
      output += text.slice(index, end + 1)
      index = end + 1
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1
    } else if (char === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2)
      index = end === -1 ? text.length : end + 2
    } else {
      output += char
      index += 1
    }
  }
  return output.replace(/,(\s*[}\]])/g, "$1")
}

function normalizeCustomThemes(value: ContractJsonInput): CustomTheme[] {
  if (!Array.isArray(value)) return []
  const themes: CustomTheme[] = []
  for (const entry of value.slice(0, MAX_CUSTOM_THEMES)) {
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
  if (!isStringValue(id) || !CUSTOM_THEME_ID_RE.test(id)) return null
  if (!isStringValue(name) || !name.trim()) return null

  const light = normalizeStoredColors(value.light)
  const dark = normalizeStoredColors(value.dark)
  if (!light && !dark) return null
  return {
    id,
    name: name.trim().slice(0, THEME_NAME_MAX_LENGTH),
    light,
    dark,
    guided: value.guided === true,
  }
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
