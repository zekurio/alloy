import {
  isObjectRecord,
  isStringValue,
  type ContractJsonValue,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { parseCssColor } from "@alloy/ui/lib/color"
import {
  contrastRatio,
  isDarkColor,
  relativeLuminance,
} from "@alloy/ui/lib/theme-color-math"
import {
  completeThemeColors,
  opaqueThemeColor,
  type ThemeAppearance,
  type ThemeColorOverrides,
  type ThemeColors,
} from "@alloy/ui/lib/theme-colors"

/**
 * Maps a VS Code color theme onto Alloy's roles. Workbench colors cover the
 * shell (editor, side bar, widgets, inputs); anything a theme leaves out is
 * derived from its background and accent like any other partial theme.
 */

const BACKGROUND_KEYS = [
  "editor.background",
  "editorPane.background",
  "sideBar.background",
]
const ACCENT_KEYS = [
  "focusBorder",
  "button.background",
  "textLink.foreground",
  "activityBarBadge.background",
  "progressBar.background",
  "badge.background",
]

export interface VsCodeTheme {
  /** The theme's own name, when it has one. */
  name: string | null
  appearance: ThemeAppearance
  colors: ThemeColors
}

/** Returns the mapped theme, or an error message when it can't be read. */
export function readVsCodeTheme(
  json: Record<string, ContractJsonValue>,
): VsCodeTheme | string {
  const workbench = isObjectRecord(json.colors) ? json.colors : {}
  const raw = (key: string) => {
    const value = workbench[key]
    return isStringValue(value) ? value : null
  }

  const backgroundValue = BACKGROUND_KEYS.map(raw).find(Boolean)
  const background = backgroundValue
    ? opaqueThemeColor(backgroundValue, "#000000")
    : null
  const backgroundColor = background ? parseCssColor(background) : null
  if (!background || !backgroundColor) {
    return t("This VS Code theme doesn't set an editor background.")
  }

  const appearance = themeAppearance(json.type, isDarkColor(backgroundColor))
  const color = (key: string) => {
    const value = raw(key)
    return value ? opaqueThemeColor(value, background) : null
  }
  const contrast = (value: string | null) => {
    const parsed = value ? parseCssColor(value) : null
    return parsed ? contrastRatio(parsed, backgroundColor) : 0
  }
  // Alloy's surfaces step away from the page: lighter in dark themes, darker
  // in light ones. Side bars that go the other way read as sunken instead.
  const lifted = (value: string) => {
    const parsed = parseCssColor(value)
    if (!parsed || contrast(value) < 1.03) return false
    const lighter =
      relativeLuminance(parsed) > relativeLuminance(backgroundColor)
    return isDarkColor(backgroundColor) ? lighter : !lighter
  }
  const first = (
    keys: readonly string[],
    accepts: (value: string) => boolean,
  ) =>
    keys.map(color).find((value): value is string => !!value && accepts(value))

  const sideBar = color("sideBar.background")
  const overrides: ThemeColorOverrides = { background }
  const surface = first(
    ["sideBar.background", "activityBar.background", "panel.background"],
    lifted,
  )
  if (surface) overrides.surface = surface
  else if (sideBar && contrast(sideBar) >= 1.03)
    overrides.surfaceSunken = sideBar

  const raised = first(
    [
      "editorWidget.background",
      "dropdown.background",
      "menu.background",
      "quickInput.background",
    ],
    lifted,
  )
  if (raised) overrides.surfaceRaised = raised
  const input = first(["input.background"], lifted)
  if (input) overrides.input = input
  const border = first(
    [
      "panel.border",
      "editorGroup.border",
      "sideBar.border",
      "editorWidget.border",
    ],
    (value) => contrast(value) >= 1.1,
  )
  if (border) overrides.border = border

  const text = first(
    ["editor.foreground", "foreground"],
    (value) => contrast(value) >= 4.5,
  )
  if (text) overrides.text = text
  const muted = first(
    ["descriptionForeground"],
    (value) => contrast(value) >= 4.5,
  )
  if (muted) overrides.textMuted = muted

  const accentKey = ACCENT_KEYS.find((key) => contrast(color(key)) >= 2)
  const accent = accentKey ? color(accentKey) : null
  if (accent) {
    overrides.accent = accent
    const buttonText = color("button.foreground")
    const buttonTextColor = buttonText ? parseCssColor(buttonText) : null
    const accentColor = parseCssColor(accent)
    if (
      accentKey === "button.background" &&
      buttonText &&
      buttonTextColor &&
      accentColor &&
      contrastRatio(buttonTextColor, accentColor) >= 4.5
    ) {
      overrides.accentForeground = buttonText
    }
  }

  const status = (keys: readonly string[]) =>
    first(keys, (value) => contrast(value) >= 3)
  const danger = status(["editorError.foreground", "errorForeground"])
  const warning = status(["editorWarning.foreground"])
  const info = status(["editorInfo.foreground"])
  const success = status([
    "gitDecoration.addedResourceForeground",
    "terminal.ansiGreen",
  ])
  if (danger) {
    overrides.danger = danger
    overrides.live = danger
  }
  if (warning) overrides.warning = warning
  if (info) overrides.info = info
  if (success) overrides.success = success

  return {
    name:
      isStringValue(json.name) && json.name.trim() ? json.name.trim() : null,
    appearance,
    colors: completeThemeColors(appearance, overrides),
  }
}

function themeAppearance(
  type: ContractJsonValue,
  darkBackground: boolean,
): ThemeAppearance {
  if (type === "light" || type === "hcLight") return "light"
  if (type === "dark" || type === "hc") return "dark"
  return darkBackground ? "dark" : "light"
}
