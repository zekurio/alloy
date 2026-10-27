import {
  THEME_MODES,
  THEME_VARIANT_NAME_MAX_LENGTH,
  type ThemeMode,
} from "@alloy/contracts"
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
  selectThemeFamily,
  selectThemeVariant,
  setThemeMode,
  setThemeSync,
  themeVariantColors,
  type ThemeState,
} from "@alloy/ui/lib/theme"
import {
  canonicalThemeColors,
  THEME_APPEARANCES,
  type ThemeAppearance,
  type ThemeColors,
} from "@alloy/ui/lib/theme-colors"
import {
  newThemeVariantId,
  serializeThemeFile,
  uniqueThemeName,
  type CustomTheme,
  type CustomThemeVariant,
} from "@alloy/ui/lib/theme-custom"
import {
  isAlloyThemeVariant,
  type ThemeFamily,
  type ThemeVariant,
} from "@alloy/ui/lib/theme-presets"
import { cn } from "@alloy/ui/lib/utils"
import { useMutation } from "@tanstack/react-query"
import {
  CopyIcon,
  DownloadIcon,
  MoonIcon,
  MoreHorizontalIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react"
import { lazy, Suspense, useRef, useState } from "react"
import type { KeyboardEvent } from "react"
import { createPortal } from "react-dom"

import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import type { ThemeEditorSeed } from "@/components/routes/settings/theme-editor"
import { ThemeImportDialog } from "@/components/routes/settings/theme-import-dialog"
import { deleteAccountTheme } from "@/lib/account-themes"
import { startBrowserDownload } from "@/lib/browser-download"
import { errorMessage } from "@/lib/error-message"
import { useThemeState } from "@/lib/theme-state"

const ThemeEditor = lazy(() =>
  import("@/components/routes/settings/theme-editor").then((module) => ({
    default: module.ThemeEditor,
  })),
)

/**
 * The Appearance panel's theme sections: the color scheme (system, light, or
 * dark), then every bundled and custom theme as a card whose swatches pick
 * light and dark separately.
 */
export function ThemeSettings() {
  const theme = useThemeState()
  const anchorRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef(0)
  const [editor, setEditor] = useState<ThemeEditorSeed | null>(null)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState<CustomTheme | null>(null)
  const deleteTheme = useMutation({
    mutationFn: deleteAccountTheme,
    onSuccess: () => setDeleting(null),
  })

  function confirmDelete() {
    if (deleting) deleteTheme.mutate(deleting.id)
  }

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
      <ColorSchemeSection theme={theme} />
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
              onClick={() => openEditor(createSeed(theme))}
            >
              <PaletteIcon />
              {t("Create theme")}
            </Button>
            <Button
              type="button"
              variant="secondary"
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
                onEdit={
                  custom
                    ? () => openEditor(editSeed(theme, family, custom))
                    : null
                }
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
          if (next) return
          setDeleting(null)
          deleteTheme.reset()
        }}
        title={t("Delete theme?")}
        description={t(
          "{theme} will be deleted from your account. Modes that use it go back to Alloy.",
          { theme: deleting?.name ?? "" },
        )}
        confirmLabel={t("Delete theme")}
        pendingLabel={t("Deleting…")}
        pending={deleteTheme.isPending}
        error={
          deleteTheme.error
            ? errorMessage(deleteTheme.error, t("Couldn't delete theme"))
            : null
        }
        onConfirm={confirmDelete}
      />
    </>
  )
}

function ColorSchemeSection({ theme }: { theme: ThemeState }) {
  return (
    <SettingsSubsection id="color-scheme" title={t("Color scheme")}>
      <ColorSchemePicker theme={theme} />
      <SettingRows>
        <SettingRow
          title={t("Sync across devices")}
          description={t(
            "Use the same color scheme and themes everywhere you sign in.",
          )}
        >
          <Switch
            checked={theme.preferences.sync}
            onCheckedChange={(checked) => setThemeSync(checked)}
          />
        </SettingRow>
      </SettingRows>
    </SettingsSubsection>
  )
}

/**
 * System, Light, and Dark as cards, each a miniature of the app in the theme
 * that mode shows. System splits the light and dark themes down the middle.
 */
function ColorSchemePicker({ theme }: { theme: ThemeState }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const light = themeVariantColors(theme, theme.light)
  const dark = themeVariantColors(theme, theme.dark)

  function moveFocus(event: KeyboardEvent, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0
    if (step === 0) return
    event.preventDefault()
    const next = (index + step + THEME_MODES.length) % THEME_MODES.length
    const mode = THEME_MODES[next]
    if (!mode) return
    setThemeMode(mode)
    buttons.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t("Color scheme")}
      className="grid grid-cols-3 gap-2 sm:gap-3"
    >
      {THEME_MODES.map((mode, index) => {
        const selected = theme.preferences.mode === mode
        return (
          <button
            key={mode}
            ref={(button) => {
              buttons.current[index] = button
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => setThemeMode(mode)}
            onKeyDown={(event) => moveFocus(event, index)}
            className={cn(
              "focus-visible:ring-ring flex min-w-0 flex-col gap-2 rounded-xl border p-1.5 pb-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 sm:p-2 sm:text-sm",
              selected
                ? "border-accent bg-accent-soft text-foreground"
                : "bg-card text-foreground-muted hover:border-border-strong border-border",
            )}
          >
            <span className="relative block">
              {mode === "system" ? (
                <>
                  {/* Light stops just past the middle: underneath the whole
                      dark half, its border showed through the dark edges. */}
                  <span className="block [clip-path:inset(0_calc(50%_-_1px)_0_0)]">
                    <AppMiniature colors={light} />
                  </span>
                  <span className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
                    <AppMiniature colors={dark} />
                  </span>
                </>
              ) : (
                <AppMiniature colors={mode === "dark" ? dark : light} />
              )}
            </span>
            <span className="truncate">{colorSchemeLabel(mode)}</span>
          </button>
        )
      })}
    </div>
  )
}

function colorSchemeLabel(mode: ThemeMode): string {
  if (mode === "light") return t("Light")
  if (mode === "dark") return t("Dark")
  return t("System")
}

/** The app in `colors`: a rail with its active item, a header, and clips. */
function AppMiniature({ colors }: { colors: ThemeColors }) {
  return (
    <span
      aria-hidden
      className="relative block aspect-[16/10] overflow-hidden rounded-lg border"
      style={{ background: colors.background, borderColor: colors.border }}
    >
      <span
        className="absolute inset-y-0 left-0 flex w-[12%] flex-col items-center gap-1 border-r pt-[5%]"
        style={{ background: colors.surface, borderColor: colors.border }}
      >
        {[colors.accent, colors.borderStrong, colors.borderStrong].map(
          (color, index) => (
            <span
              key={index}
              className="aspect-square w-1/2 rounded-[2px]"
              style={{ background: color }}
            />
          ),
        )}
      </span>
      <span
        className="absolute top-0 right-0 left-[12%] flex h-[16%] items-center justify-between gap-[6%] border-b px-[5%]"
        style={{ borderColor: colors.border }}
      >
        <span
          className="h-[18%] w-[14%] rounded-full"
          style={{ background: colors.textMuted }}
        />
        <span
          className="h-[45%] flex-1 rounded-full"
          style={{ background: colors.input }}
        />
        <span
          className="h-[45%] w-[16%] rounded-full"
          style={{ background: colors.accent }}
        />
      </span>
      <span className="absolute top-[16%] right-0 bottom-0 left-[12%] grid grid-cols-3 content-start gap-x-[5%] gap-y-1.5 p-[5%]">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} className="flex flex-col gap-1">
            <span
              className="aspect-video rounded-[2px]"
              style={{ background: colors.surfaceRaised }}
            />
            <span
              className="h-[3px] w-3/4 rounded-full"
              style={{ background: colors.textDim }}
            />
          </span>
        ))}
      </span>
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

/** Alloy's variant names are translated; palette and custom names are not. */
function variantName(variant: ThemeVariant): string {
  return isAlloyThemeVariant(variant.id) ? t(variant.label) : variant.label
}

/**
 * The variant's name inside its theme's card: "Catppuccin Mocha" reads as
 * "Mocha". Custom variants already have their own name or their appearance.
 */
function variantShortName(family: ThemeFamily, variant: ThemeVariant): string {
  if (family.custom) return variant.label
  const name = variantName(variant)
  return name.startsWith(`${family.label} `)
    ? name.slice(family.label.length + 1)
    : name
}

function swatchLabel(family: ThemeFamily, variant: ThemeVariant): string {
  if (!family.custom) return variantName(variant)
  return t("{theme} ({variant})", {
    theme: family.label,
    variant: variant.label,
  })
}

/**
 * A bundled variant's name in a copy of its theme, short as on the card.
 * Names that only say light or dark, or repeat the theme's, are dropped so
 * the copy shows the appearance in the reader's language instead.
 */
function copiedVariantName(
  family: ThemeFamily,
  variant: ThemeVariant,
): string | null {
  if (isAlloyThemeVariant(variant.id)) return null
  const name = variantShortName(family, variant)
  return name === family.label || /^(light|dark)$/i.test(name)
    ? null
    : name.slice(0, THEME_VARIANT_NAME_MAX_LENGTH)
}

/**
 * The variant to open: the one on screen if it's among `sources`, else the
 * first for the shown appearance. `variants` are copies of `sources`, in the
 * same order.
 */
function openingVariant(
  theme: ThemeState,
  sources: readonly ThemeVariant[],
  variants: readonly CustomThemeVariant[],
): string {
  const shown = sources.findIndex(
    (variant) => variant.id === theme[theme.appearance].id,
  )
  const opened =
    variants[shown] ??
    variants.find((variant) => variant.appearance === theme.appearance) ??
    variants[0]
  return opened?.id ?? ""
}

/** A new theme starts from whatever is on screen in each appearance. */
function createSeed(theme: ThemeState): Omit<ThemeEditorSeed, "session"> {
  return {
    themeId: null,
    name: "",
    variants: THEME_APPEARANCES.map((appearance) => ({
      id: appearance,
      name: null,
      appearance,
      colors: canonicalThemeColors(
        themeVariantColors(theme, theme[appearance]),
      ),
    })),
    selected: theme.appearance,
    guided: true,
  }
}

/** Copies every variant of `family`, with the colors it shows them in. */
function duplicateSeed(
  theme: ThemeState,
  family: ThemeFamily,
): Omit<ThemeEditorSeed, "session"> {
  const custom = family.custom
    ? theme.customThemes.find((entry) => entry.id === family.id)
    : undefined
  const variants =
    custom?.variants.map((variant) => ({ ...variant })) ??
    copiedVariants(theme, family)
  return {
    themeId: null,
    name: uniqueThemeName(
      t("{theme} copy", { theme: family.label }),
      theme.customThemes.map((entry) => entry.name),
    ),
    variants,
    selected: openingVariant(theme, family.variants, variants),
    guided: custom?.guided ?? false,
  }
}

/** A bundled theme's variants as custom ones, colored as they show. */
function copiedVariants(
  theme: ThemeState,
  family: ThemeFamily,
): CustomThemeVariant[] {
  const copied: CustomThemeVariant[] = []
  for (const variant of family.variants) {
    copied.push({
      id: newThemeVariantId(copied),
      name: copiedVariantName(family, variant),
      appearance: variant.appearance,
      colors: canonicalThemeColors(themeVariantColors(theme, variant)),
    })
  }
  return copied
}

function editSeed(
  theme: ThemeState,
  family: ThemeFamily,
  custom: CustomTheme,
): Omit<ThemeEditorSeed, "session"> {
  return {
    themeId: custom.id,
    name: custom.name,
    variants: custom.variants,
    selected: openingVariant(theme, family.variants, custom.variants),
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
