import { t, tp } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { Switch } from "@alloy/ui/components/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alloy/ui/components/tooltip"
import {
  deleteCustomTheme,
  selectBaseTheme,
  selectThemeFamily,
  selectThemeVariant,
  setThemeAccent,
  setThemeSync,
  themeVariantColors,
  type ThemeState,
} from "@alloy/ui/lib/theme"
import {
  canonicalThemeColors,
  defaultThemeAccent,
  normalizeThemeColor,
  THEME_APPEARANCES,
  type ThemeAppearance,
  type ThemeColors,
} from "@alloy/ui/lib/theme-colors"
import {
  serializeThemeFile,
  uniqueThemeName,
  type CustomTheme,
} from "@alloy/ui/lib/theme-custom"
import {
  BASE_THEME_VARIANTS,
  isBaseThemeVariant,
  themeFamilyDefault,
  type ThemeFamily,
  type ThemeVariant,
} from "@alloy/ui/lib/theme-presets"
import { cn } from "@alloy/ui/lib/utils"
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react"
import { lazy, Suspense, useRef, useState } from "react"
import type { CSSProperties, KeyboardEvent, ReactNode } from "react"
import { createPortal } from "react-dom"

import { HexColorInput } from "@/components/routes/settings/hex-color-input"
import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import type { ThemeEditorSeed } from "@/components/routes/settings/theme-editor"
import { ThemeImportDialog } from "@/components/routes/settings/theme-import-dialog"
import { startBrowserDownload } from "@/lib/browser-download"
import { useThemeState } from "@/lib/theme-state"

const ThemeEditor = lazy(() =>
  import("@/components/routes/settings/theme-editor").then((module) => ({
    default: module.ThemeEditor,
  })),
)

/**
 * The Appearance panel's theme sections: a row of monochrome base themes that
 * follow the server's accent, then every bundled and custom theme as a card
 * whose circles pick light and dark separately.
 */
export function ThemeSettings() {
  const theme = useThemeState()
  const anchorRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef(0)
  const [editor, setEditor] = useState<ThemeEditorSeed | null>(null)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState<CustomTheme | null>(null)

  function openEditor(seed: Omit<ThemeEditorSeed, "session">) {
    sessionRef.current += 1
    setEditor({ ...seed, session: sessionRef.current })
  }

  // Inside the settings dialog the panel has to live in the dialog's DOM:
  // anything outside it counts as an outside press and closes the dialog.
  const editorContainer =
    anchorRef.current?.closest("[data-slot=dialog-content]") ??
    globalThis.document?.body

  return (
    <>
      <BaseThemeSection theme={theme} />
      <SettingsSubsection
        id="themes"
        title={t("Themes")}
        description={t(
          "Pick a theme for both modes, or one of its swatches for just light or dark.",
        )}
        action={
          <div ref={anchorRef} className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => openEditor(createSeed(theme))}
            >
              <PaletteIcon />
              {t("Create theme")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setImporting(true)}
            >
              <PlusIcon />
              {t("Add theme")}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {theme.themes.map((family) => {
            const custom = family.custom
              ? theme.customThemes.find((entry) => entry.id === family.id)
              : undefined
            return (
              <ThemeCard
                key={family.id}
                family={family}
                theme={theme}
                onDuplicate={() => openEditor(duplicateSeed(theme, family))}
                onEdit={custom ? () => openEditor(editSeed(custom)) : null}
                onExport={custom ? () => exportTheme(custom) : null}
                onDelete={custom ? () => setDeleting(custom) : null}
              />
            )
          })}
        </div>
      </SettingsSubsection>

      {editor && editorContainer
        ? createPortal(
            <Suspense fallback={null}>
              <ThemeEditor
                key={editor.session}
                seed={editor}
                onClose={() => setEditor(null)}
              />
            </Suspense>,
            editorContainer,
          )
        : null}
      <ThemeImportDialog open={importing} onOpenChange={setImporting} />
      <ConfirmDeleteDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null)
        }}
        title={t("Delete theme?")}
        description={t(
          "{theme} will be removed from this browser. Modes that use it go back to Alloy.",
          { theme: deleting?.name ?? "" },
        )}
        confirmLabel={t("Delete theme")}
        pendingLabel={t("Deleting…")}
        pending={false}
        onConfirm={() => {
          if (deleting) deleteCustomTheme(deleting.id)
          setDeleting(null)
        }}
      />
    </>
  )
}

function BaseThemeSection({ theme }: { theme: ThemeState }) {
  const { preferences } = theme
  const accent =
    preferences.accent ?? theme.serverAccent ?? defaultThemeAccent("dark")

  return (
    <SettingsSubsection
      id="theme"
      title={t("Theme")}
      description={t(
        "Choose a base theme, or sync with your system's light and dark mode.",
      )}
    >
      <BaseThemePicker theme={theme} />
      {preferences.mode === "system" ? (
        <p className="text-foreground-dim -mt-1 text-xs">
          {t(
            "Syncing uses {light} in light mode and {dark} in dark mode. Pick a swatch under Themes to change either one.",
            {
              light: variantName(theme.light),
              dark: variantName(theme.dark),
            },
          )}
        </p>
      ) : null}
      <SettingRows>
        <SettingRow
          title={t("Accent color")}
          description={
            theme.serverAccent
              ? t(
                  "The Alloy themes use this server's accent unless you choose your own.",
                )
              : t("The Alloy themes use lavender unless you choose your own.")
          }
          htmlFor="theme-accent"
          stack
        >
          <HexColorInput
            id="theme-accent"
            value={accent}
            label={t("Accent color")}
            className="text-xs"
            commit={normalizeThemeColor}
            onChange={(color) => setThemeAccent(color)}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!preferences.accent}
              onClick={() => setThemeAccent(null)}
            >
              <RotateCcwIcon />
              {t("Reset")}
            </Button>
          </HexColorInput>
        </SettingRow>
        <SettingRow
          title={t("Sync across devices")}
          description={t(
            "Use the same theme and accent everywhere you sign in. Custom themes stay on the device they were made on.",
          )}
        >
          <Switch
            checked={preferences.sync}
            onCheckedChange={(checked) => setThemeSync(checked)}
          />
        </SettingRow>
      </SettingRows>
    </SettingsSubsection>
  )
}

const SYNC_OPTION = "system"

/**
 * Fluxer-style radio row: each monochrome base shows itself right away, and
 * the sync swatch follows the OS with the chosen light and dark themes.
 */
function BaseThemePicker({ theme }: { theme: ThemeState }) {
  const options = [...BASE_THEME_VARIANTS.map((base) => base.id), SYNC_OPTION]
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const shown = theme[theme.appearance]
  const selected =
    theme.preferences.mode === "system"
      ? SYNC_OPTION
      : isBaseThemeVariant(shown.id)
        ? shown.id
        : null
  const focusable = selected ?? options[0]
  const syncing = theme.preferences.mode === "system"
  const systemColors = themeVariantColors(theme, theme[theme.systemAppearance])

  function moveFocus(event: KeyboardEvent, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0
    if (step === 0) return
    event.preventDefault()
    const next = (index + step + options.length) % options.length
    const option = options[next]
    if (!option) return
    selectBaseTheme(option)
    buttons.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("Base theme")}
      className="flex flex-wrap gap-3"
    >
      {BASE_THEME_VARIANTS.map((variant, index) => (
        <BaseSwatch
          key={variant.id}
          label={t(variant.label)}
          selected={selected === variant.id}
          focusable={focusable === variant.id}
          buttonRef={(button) => {
            buttons.current[index] = button
          }}
          style={{
            background: variant.colors.background,
            color: variant.colors.text,
          }}
          onSelect={() => selectBaseTheme(variant.id)}
          onKeyDown={(event) => moveFocus(event, index)}
        >
          {syncing && theme[variant.appearance].id === variant.id ? (
            <ModeBadge appearance={variant.appearance} />
          ) : null}
        </BaseSwatch>
      ))}
      <BaseSwatch
        label={t("Sync with system")}
        selected={selected === SYNC_OPTION}
        focusable={focusable === SYNC_OPTION}
        buttonRef={(button) => {
          buttons.current[options.length - 1] = button
        }}
        style={{
          background: systemColors.background,
          color: systemColors.text,
        }}
        onSelect={() => selectBaseTheme(SYNC_OPTION)}
        onKeyDown={(event) => moveFocus(event, options.length - 1)}
      >
        <RefreshCwIcon className="size-5" strokeWidth={2.25} />
      </BaseSwatch>
    </div>
  )
}

function BaseSwatch({
  label,
  selected,
  focusable,
  buttonRef,
  style,
  onSelect,
  onKeyDown,
  children,
}: {
  label: string
  selected: boolean
  focusable: boolean
  buttonRef: (button: HTMLButtonElement | null) => void
  style: CSSProperties
  onSelect: () => void
  onKeyDown: (event: KeyboardEvent) => void
  children?: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            ref={buttonRef}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            tabIndex={focusable ? 0 : -1}
            onClick={onSelect}
            onKeyDown={onKeyDown}
            style={style}
            className={cn(
              "focus-visible:ring-ring focus-visible:ring-offset-background relative grid size-14 shrink-0 place-items-center rounded-full border-2 transition-[border-color] outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
              selected
                ? "border-accent"
                : "border-border-strong hover:border-border-emphasis",
            )}
          >
            {children}
            {selected ? (
              <span
                aria-hidden
                className="bg-accent text-accent-foreground ring-background absolute -top-0.5 -right-0.5 grid size-5 place-items-center rounded-full ring-2"
              >
                <CheckIcon className="size-3" strokeWidth={3} />
              </span>
            ) : null}
          </button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Marks the base theme each appearance uses while syncing with the system. */
function ModeBadge({ appearance }: { appearance: ThemeAppearance }) {
  return (
    <span
      aria-hidden
      className="bg-surface-raised text-foreground ring-background absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full ring-2"
    >
      {appearance === "light" ? (
        <SunIcon className="size-3" strokeWidth={2.5} />
      ) : (
        <MoonIcon className="size-3" strokeWidth={2.5} />
      )}
    </span>
  )
}

/**
 * A theme as a paint chip: one striped swatch per variant across the top,
 * then its name and the variants it currently lends to light and dark mode.
 */
function ThemeCard({
  family,
  theme,
  onDuplicate,
  onEdit,
  onExport,
  onDelete,
}: {
  family: ThemeFamily
  theme: ThemeState
  onDuplicate: () => void
  onEdit: (() => void) | null
  onExport: (() => void) | null
  onDelete: (() => void) | null
}) {
  const shownId = theme[theme.appearance].id
  const used = THEME_APPEARANCES.flatMap((appearance) => {
    const variant = theme[appearance]
    return family.variants.includes(variant) ? [{ appearance, variant }] : []
  })

  return (
    <div
      className={cn(
        "bg-card relative flex min-w-0 flex-col overflow-hidden rounded-xl border transition-colors",
        used.length > 0
          ? "border-accent-border"
          : "border-border hover:border-border-strong",
      )}
    >
      <button
        type="button"
        aria-pressed={used.length > 0}
        aria-label={t("Use {theme} for light and dark mode", {
          theme: family.label,
        })}
        onClick={() => selectThemeFamily(family.id)}
        className="focus-visible:ring-ring absolute inset-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-inset"
      />
      <div className="bg-border border-border pointer-events-none relative flex h-16 gap-px border-b">
        {family.variants.map((variant) => (
          <ThemeSwatch
            key={variant.id}
            label={swatchLabel(family, variant)}
            colors={themeVariantColors(theme, variant)}
            slot={
              theme[variant.appearance].id === variant.id
                ? variant.appearance
                : null
            }
            shown={shownId === variant.id}
            onSelect={() => selectThemeVariant(variant.id)}
          />
        ))}
      </div>
      <div className="pointer-events-none relative flex items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{family.label}</p>
          <p className="text-foreground-dim flex min-w-0 items-center gap-2.5 text-xs">
            {used.length > 0
              ? used.map(({ appearance, variant }) => (
                  <span
                    key={appearance}
                    className="flex min-w-0 items-center gap-1"
                  >
                    {appearance === "light" ? (
                      <SunIcon aria-hidden className="size-3 shrink-0" />
                    ) : (
                      <MoonIcon aria-hidden className="size-3 shrink-0" />
                    )}
                    <span className="truncate">
                      {variantShortName(family, variant)}
                    </span>
                  </span>
                ))
              : tp(
                  family.variants.length,
                  "{count} variant",
                  "{count} variants",
                )}
          </p>
        </div>
        {onEdit && onExport && onDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("Theme actions")}
                  className="pointer-events-auto"
                >
                  <MoreHorizontalIcon className="size-3.5" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" sideOffset={6}>
              <DropdownMenuItem onClick={onEdit}>
                <PencilIcon /> {t("Edit theme")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <CopyIcon /> {t("Duplicate")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExport}>
                <DownloadIcon /> {t("Export")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2Icon /> {t("Delete theme")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("Duplicate {theme}", { theme: family.label })}
                  className="pointer-events-auto"
                  onClick={onDuplicate}
                >
                  <CopyIcon className="size-3.5" />
                </Button>
              }
            />
            <TooltipContent>{t("Duplicate")}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

/**
 * One variant as diagonal bands of its key colors, with its status colors as
 * dots in the corner. The chip marks the mode it's used for, filled with the
 * accent while it's the one on screen.
 */
function ThemeSwatch({
  label,
  colors,
  slot,
  shown,
  onSelect,
}: {
  label: string
  colors: ThemeColors
  slot: ThemeAppearance | null
  shown: boolean
  onSelect: () => void
}) {
  const usage =
    slot === "light"
      ? t("Used in light mode")
      : slot === "dark"
        ? t("Used in dark mode")
        : null
  const description = usage ? `${label} · ${usage}` : label

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={description}
            aria-pressed={slot !== null}
            onClick={onSelect}
            style={{ backgroundImage: swatchStripes(colors) }}
            className="pointer-events-auto relative min-w-0 flex-1 transition-shadow outline-none hover:shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--foreground)_40%,transparent)] focus-visible:shadow-[inset_0_0_0_2px_var(--ring)]"
          >
            <span
              aria-hidden
              className="absolute top-1.5 right-1.5 flex gap-[3px]"
            >
              {STATUS_DOT_ROLES.map((role) => (
                <span
                  key={role}
                  className="size-1.75 rounded-full"
                  style={{
                    background: colors[role],
                    boxShadow: `0 0 0 1px ${colors.background}`,
                  }}
                />
              ))}
            </span>
            {slot ? (
              <span
                aria-hidden
                className={cn(
                  "absolute bottom-1.5 left-1.5 grid size-5 place-items-center rounded-full shadow-sm",
                  shown
                    ? "bg-accent text-accent-foreground"
                    : "bg-background/85 text-foreground",
                )}
              >
                {slot === "light" ? (
                  <SunIcon className="size-3" strokeWidth={2.5} />
                ) : (
                  <MoonIcon className="size-3" strokeWidth={2.5} />
                )}
              </span>
            ) : null}
          </button>
        }
      />
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  )
}

const STATUS_DOT_ROLES = [
  "success",
  "warning",
  "danger",
] as const satisfies readonly (keyof ThemeColors)[]

/**
 * Background, accent, and text as diagonal bands. Each edge blends over a
 * fraction of a percent so the diagonal doesn't render as steps.
 */
function swatchStripes(colors: ThemeColors): string {
  const bands: [string, number][] = [
    [colors.background, 50],
    [colors.accent, 75],
    [colors.text, 100],
  ]
  const edge = 0.4
  let from = 0
  const stops = bands.map(([color, to], index) => {
    const start = index === 0 ? 0 : from + edge
    const end = to === 100 ? 100 : to - edge
    from = to
    return `${color} ${start}% ${end}%`
  })
  return `linear-gradient(135deg, ${stops.join(", ")})`
}

/** Base theme names are translated; palette and custom names are not. */
function variantName(variant: ThemeVariant): string {
  return isBaseThemeVariant(variant.id) ? t(variant.label) : variant.label
}

/**
 * The variant's name inside its theme's card: "Catppuccin Mocha" reads as
 * "Mocha", and a custom theme's variants by their appearance.
 */
function variantShortName(family: ThemeFamily, variant: ThemeVariant): string {
  if (family.custom) {
    return variant.appearance === "light" ? t("Light") : t("Dark")
  }
  const name = variantName(variant)
  return name.startsWith(`${family.label} `)
    ? name.slice(family.label.length + 1)
    : name
}

function swatchLabel(family: ThemeFamily, variant: ThemeVariant): string {
  if (!family.custom) return variantName(variant)
  return t("{theme} ({appearance})", {
    theme: variant.label,
    appearance: variant.appearance === "light" ? t("Light") : t("Dark"),
  })
}

/** A new theme starts from whatever is on screen in each appearance. */
function createSeed(theme: ThemeState): Omit<ThemeEditorSeed, "session"> {
  return {
    themeId: null,
    name: "",
    light: canonicalThemeColors(themeVariantColors(theme, theme.light)),
    dark: canonicalThemeColors(themeVariantColors(theme, theme.dark)),
    guided: true,
  }
}

/** Copies the variants of `family` in use, or its defaults. */
function duplicateSeed(
  theme: ThemeState,
  family: ThemeFamily,
): Omit<ThemeEditorSeed, "session"> {
  const colorsFor = (appearance: ThemeAppearance) => {
    const current = theme[appearance]
    const variant = family.variants.includes(current)
      ? current
      : themeFamilyDefault(family, appearance)
    return variant
      ? canonicalThemeColors(themeVariantColors(theme, variant))
      : null
  }
  return {
    themeId: null,
    name: uniqueThemeName(
      t("{theme} copy", { theme: family.label }),
      theme.customThemes.map((custom) => custom.name),
    ),
    light: colorsFor("light"),
    dark: colorsFor("dark"),
    guided: false,
  }
}

function editSeed(custom: CustomTheme): Omit<ThemeEditorSeed, "session"> {
  return {
    themeId: custom.id,
    name: custom.name,
    light: custom.light,
    dark: custom.dark,
    guided: custom.guided,
  }
}

function exportTheme(custom: CustomTheme) {
  const url = URL.createObjectURL(
    new Blob([serializeThemeFile(custom)], { type: "application/json" }),
  )
  const slug =
    custom.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "theme"
  startBrowserDownload(url, { filename: `${slug}.alloy-theme.json` })
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
