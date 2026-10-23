export const THEME_PRESET_STYLE_ID = "alloy-theme-preset"
export const THEME_ACCENT_STYLE_ID = "alloy-theme-accent"

/**
 * Creates or reuses the `<style id>` element and sets its CSS, skipping the
 * write when nothing changed. Callers decide where it sits in `<head>`.
 */
export function writeThemeStyle(id: string, css: string): HTMLStyleElement {
  const existing = document.getElementById(id)
  const style =
    existing instanceof HTMLStyleElement
      ? existing
      : document.createElement("style")
  style.id = id
  if (style.textContent !== css) style.textContent = css
  return style
}
