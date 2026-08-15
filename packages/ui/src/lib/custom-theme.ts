import { THEME_VARIABLES_BY_NAME } from "@alloy/ui/lib/theme-variables"

export const CUSTOM_CSS_STORAGE_KEY = "alloy.customCss"
export const CUSTOM_CSS_ENABLED_STORAGE_KEY = "alloy.customCssEnabled"
export const SERVER_THEME_ENABLED_STORAGE_KEY = "alloy.serverThemeEnabled"

/** Id of the single <style> element every custom theme is written into. */
export const CUSTOM_THEME_STYLE_ID = "alloy-custom-theme"

export interface CustomThemeState {
  css: string
  /** Off keeps the CSS text but stops applying it, so edits survive an A/B. */
  enabled: boolean
  /** When false the instance's own theme is skipped for this browser. */
  serverThemeEnabled: boolean
}

export interface ThemeTokenOverrides {
  [name: string]: string
}

export const DEFAULT_CUSTOM_THEME: CustomThemeState = {
  css: "",
  enabled: true,
  serverThemeEnabled: true,
}

function readFlag(key: string, fallback: boolean): boolean {
  if (!globalThis.window) return fallback
  try {
    const stored = window.localStorage.getItem(key)
    if (stored === "true") return true
    if (stored === "false") return false
  } catch {
    // localStorage can be unavailable in hardened/privacy contexts.
  }
  return fallback
}

function writeFlag(key: string, value: boolean): void {
  if (!globalThis.window) return
  try {
    window.localStorage.setItem(key, value ? "true" : "false")
  } catch {
    // Best effort: the applied theme still holds for this session.
  }
}

export function readCustomTheme(): CustomThemeState {
  if (!globalThis.window) return DEFAULT_CUSTOM_THEME

  let css = ""
  try {
    css = window.localStorage.getItem(CUSTOM_CSS_STORAGE_KEY) ?? ""
  } catch {
    // As above — fall through to the empty default.
  }

  return {
    css,
    enabled: readFlag(CUSTOM_CSS_ENABLED_STORAGE_KEY, true),
    serverThemeEnabled: readFlag(SERVER_THEME_ENABLED_STORAGE_KEY, true),
  }
}

export function writeCustomTheme(state: CustomThemeState): void {
  if (!globalThis.window) return
  try {
    window.localStorage.setItem(CUSTOM_CSS_STORAGE_KEY, state.css)
  } catch {
    // Best effort, as above.
  }
  writeFlag(CUSTOM_CSS_ENABLED_STORAGE_KEY, state.enabled)
  writeFlag(SERVER_THEME_ENABLED_STORAGE_KEY, state.serverThemeEnabled)
}

/**
 * Writes the instance CSS then the browser's own into one <style> at the end of
 * <head>, so both beat the bundled stylesheet on document order and the user's
 * rules win ties against the instance's.
 */
export function applyCustomTheme(
  serverCss: string,
  state: CustomThemeState,
): void {
  if (!globalThis.document) return

  const css = [
    state.serverThemeEnabled ? serverCss : "",
    state.enabled ? state.css : "",
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n")

  const existing = document.getElementById(CUSTOM_THEME_STYLE_ID)
  if (!css) {
    existing?.remove()
    return
  }

  const style =
    existing instanceof HTMLStyleElement
      ? existing
      : document.createElement("style")
  style.id = CUSTOM_THEME_STYLE_ID
  if (style.textContent !== css) style.textContent = css
  if (!style.isConnected) document.head.append(style)
}

/**
 * Theme file header, in the BetterDiscord `@name`/`@author` format the wider
 * theme ecosystem already uses — so a theme exported from Alloy carries its
 * name into other tools, and one written elsewhere keeps it here.
 */
export interface ThemeMetadata {
  name: string
  description: string
  author: string
  version: string
}

export const DEFAULT_THEME_METADATA: ThemeMetadata = {
  name: "Custom theme",
  description: "",
  author: "",
  version: "1.0.0",
}

const METADATA_BLOCK = /^\s*\/\*\*([\s\S]*?)\*\//

export function parseThemeMetadata(css: string): ThemeMetadata {
  const block = css.match(METADATA_BLOCK)
  if (!block?.[1]) return DEFAULT_THEME_METADATA

  const read = (key: keyof ThemeMetadata) =>
    block[1]?.match(new RegExp(`@${key}\\s+(.+)`))?.[1]?.trim() ?? ""

  return {
    name: read("name") || DEFAULT_THEME_METADATA.name,
    description: read("description"),
    author: read("author"),
    version: read("version") || DEFAULT_THEME_METADATA.version,
  }
}

/** The CSS with its metadata header removed, for re-heading on export. */
export function stripThemeMetadata(css: string): string {
  return css.replace(METADATA_BLOCK, "").trimStart()
}

export function buildThemeFile(css: string, metadata: ThemeMetadata): string {
  const fields = [
    `@name ${metadata.name}`,
    metadata.description ? `@description ${metadata.description}` : "",
    metadata.author ? `@author ${metadata.author}` : "",
    `@version ${metadata.version}`,
  ].filter(Boolean)

  return `/**\n${fields.map((field) => ` * ${field}`).join("\n")}\n */\n\n${stripThemeMetadata(css)}\n`
}

/** `My Theme` -> `my-theme.theme.css`, falling back when nothing survives. */
export function themeFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `${slug || "theme"}.theme.css`
}

// Commented-out declarations (`/* --accent: red; */`) are dead text: readers
// strip comments first and writers pass comment matches through untouched.
const COMMENT = String.raw`\/\*[\s\S]*?\*\/`

function stripComments(css: string): string {
  return css.replace(new RegExp(COMMENT, "g"), "")
}

/**
 * One declaration of `name`. The lookbehind keeps `--accent` from matching the
 * tail of a longer token, and the terminator accepts a closing brace or end of
 * input so a final declaration without `;` is still one declaration — not text
 * a writer would miss and duplicate.
 */
function declarationSource(name: string): string {
  return String.raw`(?<![\w-])${name}\s*:\s*[^;{}]*?(?:;|(?=\s*\})|$)`
}

/**
 * Token values declared anywhere in the CSS, so the token grid reflects what
 * the editor says. A `--var` set inside a non-root selector is reported the
 * same as a root one — the editor treats the document as one flat set. When a
 * token is declared more than once the last occurrence wins, like the cascade.
 */
export function readTokenOverrides(css: string): ThemeTokenOverrides {
  const overrides: ThemeTokenOverrides = {}
  for (const [, name, value] of stripComments(css).matchAll(
    /(--[\w-]+)\s*:\s*([^;{}]+)/g,
  )) {
    if (name && value && THEME_VARIABLES_BY_NAME.has(name)) {
      overrides[name] = value.trim()
    }
  }
  return overrides
}

/**
 * Sets a token in the CSS text, rewriting the existing declarations in place
 * when there are any so the author's own formatting and comments survive.
 * Every live occurrence is rewritten — the reader reports the last one, so
 * rewriting only the first would make edits appear to do nothing.
 */
export function writeTokenOverride(
  css: string,
  name: string,
  value: string,
): string {
  const declaration = declarationSource(name)
  if (new RegExp(declaration).test(stripComments(css))) {
    return css.replace(new RegExp(`${COMMENT}|${declaration}`, "g"), (match) =>
      match.startsWith("/*") ? match : `${name}: ${value};`,
    )
  }

  const trimmed = css.trimEnd()
  const separator = trimmed ? "\n\n" : ""
  return `${trimmed}${separator}:root {\n  ${name}: ${value};\n}\n`
}

/** Drops a token's declarations, and any `:root` block left empty by that. */
export function clearTokenOverride(css: string, name: string): string {
  return css
    .replace(
      new RegExp(`${COMMENT}|\\s*${declarationSource(name)}`, "g"),
      (match) => (match.startsWith("/*") ? match : ""),
    )
    .replace(/:root\s*\{\s*\}\n?/g, "")
    .trimStart()
}

/**
 * Resolved value for the token grid: the override when set, else the value the
 * stylesheet ships. Aliases like `var(--neutral-0)` resolve one hop so the
 * colour inputs get something they can render.
 */
export function resolveTokenValue(
  name: string,
  overrides: Record<string, string>,
): string {
  const value =
    overrides[name] ?? THEME_VARIABLES_BY_NAME.get(name)?.defaultValue ?? ""
  const alias = value.match(/^var\((--[\w-]+)\)$/)
  if (!alias?.[1]) return value
  return (
    overrides[alias[1]] ??
    THEME_VARIABLES_BY_NAME.get(alias[1])?.defaultValue ??
    value
  )
}
