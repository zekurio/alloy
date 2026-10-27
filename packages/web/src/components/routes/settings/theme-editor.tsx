import {
  MAX_THEME_VARIANTS,
  messageFromUnknown,
  THEME_NAME_MAX_LENGTH,
  THEME_VARIANT_NAME_MAX_LENGTH,
} from "@alloy/contracts"
import { message, t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@alloy/ui/components/dropdown-menu"
import { Input } from "@alloy/ui/components/input"
import { Switch } from "@alloy/ui/components/switch"
import {
  endThemePreview,
  previewTheme,
  selectThemeFamily,
} from "@alloy/ui/lib/theme"
import {
  canonicalThemeColors,
  defaultThemeBackground,
  generateThemeColors,
  normalizeThemeColor,
  withDerivedAccentFamily,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
} from "@alloy/ui/lib/theme-colors"
import {
  customVariantLabel,
  newCustomThemeId,
  newThemeVariantId,
  type CustomThemeVariant,
} from "@alloy/ui/lib/theme-custom"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { useForm, useStore } from "@tanstack/react-form"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  CrosshairIcon,
  MoonIcon,
  PaletteIcon,
  PlusIcon,
  SunIcon,
  Trash2Icon,
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
  /** At least one. */
  variants: CustomThemeVariant[]
  /** The id of the variant to open. */
  selected: string
  /** Open in the two-color mode rather than with every role. */
  guided: boolean
}

/** The editor's own view state; the theme being edited lives in the form. */
interface EditorView {
  /** The variant being edited. */
  selectedId: string
  filter: string
  collapsed: boolean
  /** Whether Inspect is picking, or its last pick found no theme color. */
  inspect: "off" | "picking" | "miss"
  pickedRole: ThemeColorRole | null
}

/** What the two-color mode shows; the palette is generated from these. */
interface GuidedSeed {
  background: string
  accent: string
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
 * appearance of the variant being edited; nothing is stored until Save. The
 * guided mode asks for a background and an accent and derives the rest,
 * Advanced exposes every role, and Inspect picks a role by clicking whatever
 * it paints.
 */
export function ThemeEditor({
  seed,
  onClose,
}: {
  seed: ThemeEditorSeed
  onClose: () => void
}) {
  const [view, setView] = useState<EditorView>(() => ({
    selectedId: seed.selected,
    filter: "",
    collapsed: false,
    inspect: "off",
    pickedRole: null,
  }))
  const patchView = (patch: Partial<EditorView>) =>
    setView((current) => ({ ...current, ...patch }))
  const nameRef = useRef<HTMLInputElement>(null)
  const fieldRefs = useRef(new Map<ThemeColorRole, HTMLDivElement>())
  const form = useForm({
    defaultValues: {
      name: seed.name,
      variants: seed.variants,
      seeds: guidedSeeds(seed.variants),
      advanced: !seed.guided,
    },
    onSubmit: async ({ value }) => {
      const trimmed = value.name.trim()
      if (!trimmed) {
        patchView({ collapsed: false })
        nameRef.current?.focus()
        return
      }
      try {
        const saved = await saveAccountTheme({
          id: seed.themeId ?? newCustomThemeId(),
          name: trimmed.slice(0, THEME_NAME_MAX_LENGTH),
          variants: value.variants.map((variant) => ({
            ...variant,
            name:
              variant.name
                ?.trim()
                .slice(0, THEME_VARIANT_NAME_MAX_LENGTH)
                .trim() || null,
            colors: canonicalThemeColors(variant.colors),
          })),
          guided: !value.advanced,
        })
        if (!seed.themeId) selectThemeFamily(saved.id)
        onClose()
      } catch (cause) {
        toast.error(t("Couldn't save theme"), {
          description: messageFromUnknown(cause) ?? undefined,
        })
      }
    },
  })
  const { variants, seeds, advanced } = useStore(
    form.store,
    (state) => state.values,
  )
  const saving = useStore(form.store, (state) => state.isSubmitting)
  // Flagged once a save was blocked, until the name is filled in.
  const nameMissing = useStore(
    form.store,
    (state) => state.submissionAttempts > 0 && !state.values.name.trim(),
  )
  // Removing a variant always leaves at least one.
  const selected =
    variants.find((variant) => variant.id === view.selectedId) ?? variants[0]
  const { appearance, colors } = selected
  const full = variants.length >= MAX_THEME_VARIANTS

  useEffect(() => {
    previewTheme(appearance, colors)
  }, [appearance, colors])
  useEffect(() => endThemePreview, [])

  const hovered = useThemeInspector(
    view.inspect === "picking",
    (role) => {
      if (!role) {
        patchView({ inspect: "miss" })
        return
      }
      form.setFieldValue("advanced", true)
      patchView({
        inspect: "off",
        collapsed: false,
        filter: "",
        pickedRole: role,
      })
      requestAnimationFrame(() =>
        fieldRefs.current
          .get(role)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      )
    },
    () => patchView({ inspect: "off" }),
  )

  function setVariants(
    update: (current: CustomThemeVariant[]) => CustomThemeVariant[],
  ) {
    form.setFieldValue("variants", update)
  }

  function updateSelected(change: Partial<CustomThemeVariant>) {
    setVariants((current) =>
      current.map((variant) =>
        variant.id === selected.id ? { ...variant, ...change } : variant,
      ),
    )
  }

  function updateGuided(field: "background" | "accent", value: string) {
    const nextSeed = {
      ...(seeds[selected.id] ?? guidedSeed(colors)),
      [field]: value,
    }
    form.setFieldValue("seeds", (current) => ({
      ...current,
      [selected.id]: nextSeed,
    }))
    updateSelected({
      colors: generateThemeColors(
        appearance,
        nextSeed.background,
        nextSeed.accent,
      ),
    })
  }

  function updateRole(role: ThemeColorRole, value: string) {
    const next = { ...colors, [role]: value }
    // The accent's hover, pressed, and text colors follow it; they can be
    // tuned again afterwards.
    updateSelected({
      colors: role === "accent" ? withDerivedAccentFamily(next) : next,
    })
  }

  function toggleAdvanced(next: boolean) {
    form.setFieldValue("advanced", next)
    // Guided fields pick up from wherever the hand edits left the palettes.
    if (!next) form.setFieldValue("seeds", guidedSeeds(variants))
  }

  function insertVariant(variant: CustomThemeVariant, index: number) {
    setVariants((current) => current.toSpliced(index, 0, variant))
    form.setFieldValue("seeds", (current) => ({
      ...current,
      [variant.id]: guidedSeed(variant.colors),
    }))
    patchView({ selectedId: variant.id })
  }

  /**
   * A fresh palette on the appearance's default background, keeping the
   * selected variant's accent. It joins the theme's other variants for that
   * appearance, light ones first.
   */
  function addVariant(target: ThemeAppearance) {
    const last = variants.findLastIndex(
      (variant) => variant.appearance === target,
    )
    insertVariant(
      {
        id: newThemeVariantId(variants),
        name: null,
        appearance: target,
        colors: generateThemeColors(
          target,
          defaultThemeBackground(target),
          colors.accent,
        ),
      },
      last >= 0 ? last + 1 : target === "light" ? 0 : variants.length,
    )
  }

  function duplicateVariant() {
    const copiedName = selected.name?.trim()
    insertVariant(
      {
        ...selected,
        id: newThemeVariantId(variants),
        name: copiedName
          ? t("{theme} copy", { theme: copiedName }).slice(
              0,
              THEME_VARIANT_NAME_MAX_LENGTH,
            )
          : null,
      },
      variants.indexOf(selected) + 1,
    )
  }

  function removeVariant() {
    if (variants.length < 2) return
    const index = variants.indexOf(selected)
    const remaining = variants.filter((variant) => variant !== selected)
    setVariants(() => remaining)
    patchView({
      selectedId: remaining[Math.min(index, remaining.length - 1)]?.id ?? "",
    })
  }

  const { filter, collapsed, inspect, pickedRole } = view
  const query = filter.trim().toLowerCase()
  const groups = ROLE_GROUPS.map((group) => ({
    label: group.label,
    roles: group.roles.filter(
      (role) => !query || t(ROLE_LABELS[role]).toLowerCase().includes(query),
    ),
  })).filter((group) => group.roles.length > 0)
  const status =
    inspect === "picking"
      ? t("Click anything to find its color. Esc cancels.")
      : inspect === "miss"
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
            variant={inspect === "picking" ? "accent-outline" : "ghost"}
            size="sm"
            aria-pressed={inspect === "picking"}
            onClick={() =>
              setView((current) => ({
                ...current,
                inspect: current.inspect === "picking" ? "off" : "picking",
              }))
            }
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
            onClick={() =>
              setView((current) => ({
                ...current,
                collapsed: !current.collapsed,
              }))
            }
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
                <form.Field name="name">
                  {(field) => (
                    <Input
                      ref={nameRef}
                      id="theme-editor-name"
                      value={field.state.value}
                      maxLength={THEME_NAME_MAX_LENGTH}
                      placeholder={t("e.g. Aurora")}
                      aria-invalid={nameMissing || undefined}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                  )}
                </form.Field>
                <span
                  id="theme-editor-variants"
                  className="self-start pt-1 text-sm font-medium"
                >
                  {t("Variants")}
                </span>
                <div
                  role="group"
                  aria-labelledby="theme-editor-variants"
                  className="flex min-w-0 flex-wrap items-center gap-1"
                >
                  {variants.map((variant) => (
                    <button
                      key={variant.id}
                      type="button"
                      aria-pressed={variant === selected}
                      onClick={() => patchView({ selectedId: variant.id })}
                      className={cn(
                        "focus-visible:ring-ring flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium outline-none focus-visible:ring-2",
                        variant === selected
                          ? "border-accent-border bg-accent-soft text-foreground"
                          : "border-border text-foreground-dim hover:border-border-strong hover:text-foreground",
                      )}
                    >
                      {variant.appearance === "light" ? (
                        <SunIcon aria-hidden className="size-3.5 shrink-0" />
                      ) : (
                        <MoonIcon aria-hidden className="size-3.5 shrink-0" />
                      )}
                      <span className="truncate">
                        {customVariantLabel(variants, variant)}
                      </span>
                    </button>
                  ))}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("Add variant")}
                          disabled={full}
                        >
                          <PlusIcon className="size-4" />
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="start" sideOffset={6}>
                      <DropdownMenuItem onClick={() => addVariant("light")}>
                        <SunIcon /> {t("Light variant")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => addVariant("dark")}>
                        <MoonIcon /> {t("Dark variant")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <label
                  htmlFor="theme-editor-variant-name"
                  className="text-sm font-medium"
                >
                  {t("Variant name")}
                </label>
                <Input
                  id="theme-editor-variant-name"
                  value={selected.name ?? ""}
                  maxLength={THEME_VARIANT_NAME_MAX_LENGTH}
                  placeholder={customVariantLabel(variants, {
                    ...selected,
                    name: null,
                  })}
                  onChange={(event) =>
                    updateSelected({ name: event.target.value })
                  }
                />
              </div>

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
                      onChange={(event) =>
                        patchView({ filter: event.target.value })
                      }
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
                      value={
                        (seeds[selected.id] ?? guidedSeed(colors)).background
                      }
                      highlighted={false}
                      onChange={(value) => updateGuided("background", value)}
                    />
                    <ColorField
                      id="theme-guided-accent"
                      label={t("Accent")}
                      value={(seeds[selected.id] ?? guidedSeed(colors)).accent}
                      highlighted={false}
                      onChange={(value) => updateGuided("accent", value)}
                    />
                  </div>
                )}

                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={full}
                    onClick={duplicateVariant}
                  >
                    <CopyIcon />
                    {t("Duplicate variant")}
                  </Button>
                  {variants.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={removeVariant}
                    >
                      <Trash2Icon />
                      {t("Remove variant")}
                    </Button>
                  ) : null}
                </div>
              </div>
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
                onClick={() => void form.handleSubmit()}
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

function guidedSeed(colors: ThemeColors): GuidedSeed {
  return { background: colors.background, accent: colors.accent }
}

function guidedSeeds(
  variants: readonly CustomThemeVariant[],
): Record<string, GuidedSeed> {
  return Object.fromEntries(
    variants.map((variant) => [variant.id, guidedSeed(variant.colors)]),
  )
}
