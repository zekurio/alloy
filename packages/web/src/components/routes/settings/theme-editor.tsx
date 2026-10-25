import { messageFromUnknown, THEME_NAME_MAX_LENGTH } from "@alloy/contracts"
import { message, t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Input } from "@alloy/ui/components/input"
import { Switch } from "@alloy/ui/components/switch"
import {
  endThemePreview,
  getThemeState,
  previewTheme,
  selectThemeFamily,
} from "@alloy/ui/lib/theme"
import {
  canonicalThemeColors,
  defaultThemeBackground,
  generateThemeColors,
  normalizeThemeColor,
  THEME_APPEARANCES,
  withDerivedAccentFamily,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
} from "@alloy/ui/lib/theme-colors"
import { newCustomThemeId } from "@alloy/ui/lib/theme-custom"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CrosshairIcon,
  MoonIcon,
  PaletteIcon,
  PlusIcon,
  SunIcon,
  XIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { HexColorInput } from "@/components/routes/settings/hex-color-input"
import { useThemeInspector } from "@/components/routes/settings/theme-inspector"
import { saveAccountTheme } from "@/lib/account-themes"

export interface ThemeEditorSeed {
  /** Bumped per opening so the editor remounts with fresh state. */
  session: number
  /** The custom theme being edited; null creates a new one. */
  themeId: string | null
  name: string
  light: ThemeColors | null
  dark: ThemeColors | null
  /** Open in the two-color mode rather than with every role. */
  guided: boolean
}

interface Palettes {
  light: ThemeColors | null
  dark: ThemeColors | null
}

/** What the two-color mode shows; the palette is generated from these. */
interface GuidedSeed {
  background: string
  accent: string
}

interface GuidedSeeds {
  light: GuidedSeed
  dark: GuidedSeed
}

const ROLE_LABELS = {
  background: message("Background"),
  surface: message("Surface"),
  surfaceRaised: message("Raised surface"),
  surfaceSunken: message("Sunken surface"),
  input: message("Input"),
  border: message("Border"),
  borderStrong: message("Strong border"),
  borderEmphasis: message("Emphasis border"),
  text: message("Text"),
  textMuted: message("Muted text"),
  textDim: message("Dim text"),
  textFaint: message("Faint text"),
  accent: message("Accent"),
  accentForeground: message("Text on accent"),
  accentHover: message("Accent hover"),
  accentActive: message("Accent pressed"),
  accentDim: message("Dim accent"),
  success: message("Success"),
  warning: message("Warning"),
  danger: message("Danger"),
  info: message("Info"),
  live: message("Live"),
} satisfies Record<ThemeColorRole, string>

const ROLE_GROUPS: readonly {
  label: string
  roles: readonly ThemeColorRole[]
}[] = [
  {
    label: message("Surfaces"),
    roles: ["background", "surface", "surfaceRaised", "surfaceSunken", "input"],
  },
  {
    label: message("Borders"),
    roles: ["border", "borderStrong", "borderEmphasis"],
  },
  {
    label: message("Text"),
    roles: ["text", "textMuted", "textDim", "textFaint"],
  },
  {
    label: message("Accent"),
    roles: [
      "accent",
      "accentForeground",
      "accentHover",
      "accentActive",
      "accentDim",
    ],
  },
  {
    label: message("Status"),
    roles: ["success", "warning", "danger", "info", "live"],
  },
]

/**
 * Floating theme editor. Every change previews live on the page in the
 * appearance being edited; nothing is stored until Save. The guided mode asks
 * for a background and an accent and derives the rest, Advanced exposes every
 * role, and Inspect picks a role by clicking whatever it paints.
 */
export function ThemeEditor({
  seed,
  onClose,
}: {
  seed: ThemeEditorSeed
  onClose: () => void
}) {
  const [name, setName] = useState(seed.name)
  const [nameMissing, setNameMissing] = useState(false)
  const [palettes, setPalettes] = useState<Palettes>({
    light: seed.light,
    dark: seed.dark,
  })
  const [seeds, setSeeds] = useState<GuidedSeeds>(() => guidedSeeds(palettes))
  const [appearance, setAppearance] = useState<ThemeAppearance>(() => {
    const shown = getThemeState().appearance
    return seed[shown] ? shown : seed.light ? "light" : "dark"
  })
  const [advanced, setAdvanced] = useState(!seed.guided)
  const [filter, setFilter] = useState("")
  const [collapsed, setCollapsed] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [pickedRole, setPickedRole] = useState<ThemeColorRole | null>(null)
  const [inspectMiss, setInspectMiss] = useState(false)
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const fieldRefs = useRef(new Map<ThemeColorRole, HTMLDivElement>())
  const colors = palettes[appearance]

  useEffect(() => {
    if (colors) previewTheme(appearance, colors)
    else endThemePreview()
  }, [appearance, colors])
  useEffect(() => endThemePreview, [])

  const hovered = useThemeInspector(
    inspecting,
    (role) => {
      setInspecting(false)
      setInspectMiss(role === null)
      if (!role) return
      setAdvanced(true)
      setCollapsed(false)
      setFilter("")
      setPickedRole(role)
      requestAnimationFrame(() =>
        fieldRefs.current
          .get(role)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      )
    },
    () => setInspecting(false),
  )

  function updatePalette(next: ThemeColors) {
    setPalettes((current) => ({ ...current, [appearance]: next }))
  }

  function updateGuided(field: "background" | "accent", value: string) {
    const nextSeed = { ...seeds[appearance], [field]: value }
    setSeeds((current) => ({ ...current, [appearance]: nextSeed }))
    updatePalette(
      generateThemeColors(appearance, nextSeed.background, nextSeed.accent),
    )
  }

  function updateRole(role: ThemeColorRole, value: string) {
    if (!colors) return
    const next = { ...colors, [role]: value }
    // The accent's hover, pressed, and text colors follow it; they can be
    // tuned again afterwards.
    updatePalette(role === "accent" ? withDerivedAccentFamily(next) : next)
  }

  function toggleAdvanced(next: boolean) {
    setAdvanced(next)
    // Guided fields pick up from wherever the hand edits left the palette.
    if (!next) setSeeds(guidedSeeds(palettes))
  }

  function addAppearance() {
    const other = palettes[appearance === "light" ? "dark" : "light"]
    const generated = generateThemeColors(
      appearance,
      defaultThemeBackground(appearance),
      other?.accent ?? seeds[appearance].accent,
    )
    setPalettes((current) => ({ ...current, [appearance]: generated }))
    setSeeds((current) => ({
      ...current,
      [appearance]: {
        background: generated.background,
        accent: generated.accent,
      },
    }))
  }

  function removeAppearance() {
    const remaining = appearance === "light" ? "dark" : "light"
    if (!palettes[remaining]) return
    setPalettes((current) => ({ ...current, [appearance]: null }))
    setAppearance(remaining)
  }

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) {
      setNameMissing(true)
      setCollapsed(false)
      nameRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      const saved = await saveAccountTheme({
        id: seed.themeId ?? newCustomThemeId(),
        name: trimmed.slice(0, THEME_NAME_MAX_LENGTH),
        light: palettes.light ? canonicalThemeColors(palettes.light) : null,
        dark: palettes.dark ? canonicalThemeColors(palettes.dark) : null,
        guided: !advanced,
      })
      if (!seed.themeId) selectThemeFamily(saved.id)
      onClose()
    } catch (cause) {
      toast.error(t("Couldn't save theme"), {
        description: messageFromUnknown(cause) ?? undefined,
      })
      setSaving(false)
    }
  }

  const query = filter.trim().toLowerCase()
  const groups = ROLE_GROUPS.map((group) => ({
    label: group.label,
    roles: group.roles.filter(
      (role) => !query || t(ROLE_LABELS[role]).toLowerCase().includes(query),
    ),
  })).filter((group) => group.roles.length > 0)
  const status = inspecting
    ? t("Click anything to find its color. Esc cancels.")
    : inspectMiss
      ? t("That element doesn't use a theme color.")
      : pickedRole
        ? t(ROLE_LABELS[pickedRole])
        : t("Changes preview live")

  return (
    <>
      <section
        data-theme-editor=""
        aria-label={seed.themeId ? t("Edit theme") : t("Create theme")}
        className={cn(
          "bg-popover text-popover-foreground border-border fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100%-2rem))] flex-col overflow-hidden rounded-xl border shadow-lg",
          "max-h-[min(42rem,calc(100%-2rem))]",
          "max-md:bottom-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom)+0.5rem)]",
        )}
      >
        <header className="border-border flex items-center gap-2 border-b py-2 pr-2 pl-3.5">
          <PaletteIcon className="text-accent size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">
              {seed.themeId ? t("Edit theme") : t("Create theme")}
            </h2>
            <p
              className="text-foreground-dim truncate text-xs"
              aria-live="polite"
            >
              {status}
            </p>
          </div>
          <Button
            type="button"
            variant={inspecting ? "accent-outline" : "ghost"}
            size="sm"
            aria-pressed={inspecting}
            disabled={!colors}
            onClick={() => {
              setInspectMiss(false)
              setInspecting((current) => !current)
            }}
          >
            <CrosshairIcon />
            {t("Inspect")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={collapsed ? t("Expand") : t("Collapse")}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? (
              <ChevronUpIcon className="size-4" />
            ) : (
              <ChevronDownIcon className="size-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Close")}
            onClick={onClose}
          >
            <XIcon className="size-4" />
          </Button>
        </header>

        {collapsed ? null : (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3.5">
              <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
                <label
                  htmlFor="theme-editor-name"
                  className="text-sm font-medium"
                >
                  {t("Theme name")}
                </label>
                <Input
                  ref={nameRef}
                  id="theme-editor-name"
                  value={name}
                  maxLength={THEME_NAME_MAX_LENGTH}
                  placeholder={t("e.g. Aurora")}
                  aria-invalid={nameMissing || undefined}
                  onChange={(event) => {
                    setName(event.target.value)
                    setNameMissing(false)
                  }}
                />
                <span className="text-sm font-medium">{t("Appearance")}</span>
                <div
                  role="group"
                  aria-label={t("Appearance")}
                  className="bg-surface-sunken border-border flex w-fit gap-1 rounded-lg border p-0.5"
                >
                  {THEME_APPEARANCES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={appearance === option}
                      onClick={() => setAppearance(option)}
                      className={cn(
                        "focus-visible:ring-ring flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-2",
                        appearance === option
                          ? "bg-surface-raised text-foreground shadow-sm"
                          : "text-foreground-dim hover:text-foreground",
                      )}
                    >
                      {option === "light" ? (
                        <SunIcon className="size-3.5" />
                      ) : (
                        <MoonIcon className="size-3.5" />
                      )}
                      {option === "light" ? t("Light") : t("Dark")}
                    </button>
                  ))}
                </div>
              </div>

              {colors ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex-1 text-sm font-medium">
                      {t("Colors")}
                    </span>
                    {advanced ? (
                      <Input
                        value={filter}
                        placeholder={t("Filter colors")}
                        aria-label={t("Filter colors")}
                        className="h-7 w-32 text-xs sm:h-7"
                        onChange={(event) => setFilter(event.target.value)}
                      />
                    ) : null}
                    <label className="flex items-center gap-2 text-xs font-medium">
                      {t("Advanced")}
                      <Switch
                        size="sm"
                        checked={advanced}
                        onCheckedChange={toggleAdvanced}
                      />
                    </label>
                  </div>

                  {advanced ? (
                    groups.map((group) => (
                      <div key={group.label} className="flex flex-col gap-1">
                        <h3 className="text-foreground-faint px-1.5 text-xs font-medium">
                          {t(group.label)}
                        </h3>
                        {group.roles.map((role) => (
                          <ColorField
                            key={role}
                            id={`theme-color-${role}`}
                            label={t(ROLE_LABELS[role])}
                            value={colors[role]}
                            highlighted={pickedRole === role}
                            fieldRef={(element) => {
                              if (element) fieldRefs.current.set(role, element)
                              else fieldRefs.current.delete(role)
                            }}
                            onChange={(value) => updateRole(role, value)}
                          />
                        ))}
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col gap-1">
                      <p className="text-foreground-dim px-1.5 pb-1 text-xs">
                        {t("Pick two colors; Alloy derives the rest.")}
                      </p>
                      <ColorField
                        id="theme-guided-background"
                        label={t("Background")}
                        value={seeds[appearance].background}
                        highlighted={false}
                        onChange={(value) => updateGuided("background", value)}
                      />
                      <ColorField
                        id="theme-guided-accent"
                        label={t("Accent")}
                        value={seeds[appearance].accent}
                        highlighted={false}
                        onChange={(value) => updateGuided("accent", value)}
                      />
                    </div>
                  )}

                  {palettes.light && palettes.dark ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="self-start"
                      onClick={removeAppearance}
                    >
                      {appearance === "light"
                        ? t("Remove light version")
                        : t("Remove dark version")}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="border-border flex flex-col items-start gap-2 rounded-lg border border-dashed p-3">
                  <p className="text-foreground-dim text-xs">
                    {appearance === "light"
                      ? t("This theme has no light version yet.")
                      : t("This theme has no dark version yet.")}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={addAppearance}
                  >
                    <PlusIcon />
                    {appearance === "light"
                      ? t("Add light version")
                      : t("Add dark version")}
                  </Button>
                </div>
              )}
            </div>
            <footer className="border-border flex items-center justify-end gap-2 border-t px-3.5 py-2.5">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                {t("Cancel")}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={saving}
                onClick={() => void save()}
              >
                {seed.themeId ? t("Save theme") : t("Create theme")}
              </Button>
            </footer>
          </>
        )}
      </section>
      {hovered
        ? createPortal(
            <div
              aria-hidden
              className="outline-accent pointer-events-none fixed z-[100] rounded-sm outline-2 outline-offset-1"
              style={{
                left: hovered.left,
                top: hovered.top,
                width: hovered.width,
                height: hovered.height,
              }}
            />,
            document.body,
          )
        : null}
    </>
  )
}

function ColorField({
  id,
  label,
  value,
  highlighted,
  fieldRef,
  onChange,
}: {
  id: string
  label: string
  value: string
  highlighted: boolean
  fieldRef?: (element: HTMLDivElement | null) => void
  onChange: (value: string) => void
}) {
  return (
    <div
      ref={fieldRef}
      className={cn(
        "flex items-center gap-3 rounded-md px-1.5 py-1 transition-colors",
        highlighted && "bg-accent-soft",
      )}
    >
      <label
        htmlFor={id}
        className="text-foreground-muted min-w-0 flex-1 truncate text-sm"
      >
        {label}
      </label>
      <div className="w-40 shrink-0">
        <HexColorInput
          id={id}
          value={value}
          label={label}
          className="h-8 text-xs sm:h-8"
          commit={normalizeThemeColor}
          onChange={(color) => onChange(color.toLowerCase())}
        />
      </div>
    </div>
  )
}

function guidedSeeds(palettes: Palettes): GuidedSeeds {
  const seedFor = (appearance: ThemeAppearance): GuidedSeed => {
    const colors =
      palettes[appearance] ??
      generateThemeColors(
        appearance,
        defaultThemeBackground(appearance),
        palettes[appearance === "light" ? "dark" : "light"]?.accent ?? "",
      )
    return { background: colors.background, accent: colors.accent }
  }
  return { light: seedFor("light"), dark: seedFor("dark") }
}
