import { t } from "@alloy/i18n"
import { AppMainColumn } from "@alloy/ui/components/app-shell"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@alloy/ui/components/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { Spinner } from "@alloy/ui/components/spinner"
import { cn } from "@alloy/ui/lib/utils"
import { useBlocker } from "@tanstack/react-router"
import { SearchIcon, XIcon } from "lucide-react"
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { AdminConfigProvider } from "@/components/routes/settings/admin-config-context"
import { DesktopRecordingProvider } from "@/components/routes/settings/desktop/desktop-recording-context"
import {
  type SettingsCategory,
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_GROUPS,
  useSettingsCategories,
} from "@/components/routes/settings/settings-categories"
import { SettingsSaveBar } from "@/components/routes/settings/settings-save-bar"
import {
  SettingsSaveProvider,
  useSettingsSaveState,
} from "@/components/routes/settings/settings-save-context"
import { SettingsSectionNav } from "@/components/routes/settings/settings-section-nav"
import { SettingsSectionsProvider } from "@/components/routes/settings/settings-sections-context"

interface SettingsDialogProps {
  section: string | null
  onNavigate: (section: string) => void
  onClose: () => void
}

export function SettingsDialog(props: SettingsDialogProps) {
  return (
    <SettingsSaveProvider>
      <SettingsDialogRoot {...props} />
    </SettingsSaveProvider>
  )
}

export function SettingsPage() {
  return (
    <SettingsSaveProvider>
      <SettingsPageRoot />
    </SettingsSaveProvider>
  )
}

function SettingsPageRoot() {
  const categories = useSettingsCategories()
  const [section, setSection] = useState(DEFAULT_SETTINGS_SECTION)
  const { dirty, requestAttention } = useSettingsSaveState()
  useBlocker({
    disabled: !dirty,
    enableBeforeUnload: dirty,
    shouldBlockFn: () => {
      requestAttention()
      return true
    },
  })
  const active =
    categories.find((category) => category.id === section) ?? categories[0]

  if (!active) return null

  return (
    <AppMainColumn className="bg-surface flex-row max-md:pb-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom))]">
      <SettingsProviders categories={categories}>
        <SettingsDialogContent
          native
          categories={categories}
          active={active}
          onNavigate={setSection}
        />
      </SettingsProviders>
    </AppMainColumn>
  )
}

function SettingsDialogRoot({
  section,
  onNavigate,
  onClose,
}: SettingsDialogProps) {
  const categories = useSettingsCategories()
  const open = section !== null && categories.length > 0
  const [visibleSection, setVisibleSection] = useState(section)
  useEffect(() => {
    if (section !== null) setVisibleSection(section)
  }, [section])

  const { dirty, requestAttention } = useSettingsSaveState()

  const activeSection = section ?? visibleSection
  const active =
    categories.find((category) => category.id === activeSection) ??
    categories[0]
  const body = active ? (
    <SettingsDialogContent
      categories={categories}
      active={active}
      onNavigate={onNavigate}
    />
  ) : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return
        // Closing with unsaved edits (Escape, outside click, the X) is
        // blocked; the save bar shakes to point at Save/Cancel instead.
        if (dirty) {
          requestAttention()
          return
        }
        onClose()
      }}
    >
      <DialogContent
        variant="secondary"
        disableZoom
        className={cn(
          "flex h-[94vh] max-h-[1040px] w-[calc(100vw-2rem)] max-w-7xl gap-0 overflow-hidden p-0",
          "settings-sheet max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0",
        )}
      >
        <DialogTitle className="sr-only">{t("Settings")}</DialogTitle>
        <SettingsProviders categories={categories}>{body}</SettingsProviders>
      </DialogContent>
    </Dialog>
  )
}

function SettingsProviders({
  categories,
  children,
}: {
  categories: SettingsCategory[]
  children: ReactNode
}) {
  const withAdmin = categories.some(
    (category) => category.group === "admin",
  ) ? (
    <AdminConfigProvider>{children}</AdminConfigProvider>
  ) : (
    children
  )
  return categories.some((category) => category.group === "desktop") ? (
    <DesktopRecordingProvider>{withAdmin}</DesktopRecordingProvider>
  ) : (
    withAdmin
  )
}

function SettingsDialogContent({
  native = false,
  categories,
  active,
  onNavigate,
}: {
  native?: boolean
  categories: SettingsCategory[]
  active: SettingsCategory
  onNavigate: (section: string) => void
}) {
  const ActivePanel = active.Panel
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const { dirty, requestAttention } = useSettingsSaveState()
  // Switching tabs unmounts the active panel and would silently drop its
  // edits, so it gets the same unsaved-changes guard as closing.
  const navigateTo = (sectionId: string) => {
    if (sectionId === active.id) return
    if (dirty) {
      requestAttention()
      return
    }
    onNavigate(sectionId)
  }
  const [query, setQuery] = useState("")
  const normalized = query.trim().toLowerCase()
  const matches = useMemo<
    { category: SettingsCategory; hint: string | null }[]
  >(() => {
    if (!normalized) {
      return categories.map((category) => ({ category, hint: null }))
    }
    return categories.flatMap((category) => {
      const inLabel = `${category.label} ${category.title ?? ""}`
        .toLowerCase()
        .includes(normalized)
      const inDescription = (category.description ?? "")
        .toLowerCase()
        .includes(normalized)
      const matchedKeyword =
        category.keywords?.find((keyword) =>
          keyword.toLowerCase().includes(normalized),
        ) ?? null
      if (!inLabel && !inDescription && !matchedKeyword) return []
      // Surface the matched option when the tab's own name didn't match, so it
      // is clear why the tab appears.
      return [{ category, hint: inLabel ? null : matchedKeyword }]
    })
  }, [categories, normalized])

  return (
    <SettingsSectionsProvider>
      <nav className="border-border bg-background hidden w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r p-5 sm:flex">
        <div className="text-foreground px-2.5 pb-3 text-lg font-semibold tracking-[var(--tracking-tight)]">
          {t("Settings")}
        </div>
        <InputGroup className="mb-1">
          <InputGroupAddon>
            <SearchIcon className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t("Search settings")}
            aria-label={t("Search settings")}
            className="[&::-webkit-search-cancel-button]:appearance-none"
          />
        </InputGroup>
        {SETTINGS_GROUPS.map((group) => {
          const items = matches.filter(
            (match) => match.category.group === group.id,
          )
          if (items.length === 0) return null
          return (
            <div key={group.id} className="flex flex-col gap-0.5">
              {group.id !== "account" ? (
                <div className="text-foreground-faint px-2.5 pt-5 pb-1.5 text-xs font-medium">
                  {group.label}
                </div>
              ) : null}
              {items.map(({ category, hint }) => {
                const Icon = category.icon
                const isActive = category.id === active.id
                return (
                  <div key={category.id} className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => navigateTo(category.id)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left text-sm transition-colors",
                        isActive
                          ? "bg-surface-raised text-foreground font-medium"
                          : "text-foreground-dim hover:text-foreground hover:bg-white/[0.03]",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{category.label}</span>
                        {hint ? (
                          <span className="text-foreground-faint truncate text-xs font-normal capitalize">
                            {hint}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {/* Searching filters the list down to what matched; the
                        subsections of one tab would only bury that. */}
                    {isActive && !normalized ? (
                      <SettingsSectionNav scrollRef={scrollRef} />
                    ) : null}
                  </div>
                )
              })}
            </div>
          )
        })}
        {matches.length === 0 ? (
          <p className="text-foreground-faint px-2.5 pt-3 text-sm">
            {t("No settings found.")}
          </p>
        ) : null}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Discord-style title bar: the category name and the close button stay
            pinned while the panel below them scrolls. */}
        <header className="border-border bg-background flex shrink-0 flex-col gap-3 border-b px-5 py-3 sm:px-10">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-foreground truncate text-base font-medium">
              {active.title ?? active.label}
            </h2>
            {native ? null : (
              <DialogClose
                aria-label={t("Close settings")}
                className="text-foreground-muted hover:text-foreground focus-visible:ring-ring grid size-7 shrink-0 place-items-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <XIcon className="size-4" />
              </DialogClose>
            )}
          </div>
          <div className="sm:hidden">
            <Select
              value={active.id}
              onValueChange={(value) => {
                if (value) navigateTo(value)
              }}
            >
              <SelectTrigger
                aria-label={t("Settings sections")}
                className="w-full"
              >
                <SelectValue>
                  <active.icon className="size-4 shrink-0" />
                  <span>{active.label}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                {SETTINGS_GROUPS.map((group) => {
                  const items = categories.filter(
                    (category) => category.group === group.id,
                  )
                  if (items.length === 0) return null
                  return (
                    <SelectGroup key={group.id}>
                      {group.id !== "account" ? (
                        <SelectLabel>{group.label}</SelectLabel>
                      ) : null}
                      {items.map((category) => {
                        const Icon = category.icon
                        return (
                          <SelectItem key={category.id} value={category.id}>
                            <Icon className="size-4 shrink-0" />
                            <span>{category.label}</span>
                          </SelectItem>
                        )
                      })}
                    </SelectGroup>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
        </header>

        <div
          ref={scrollRef}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:py-8 sm:pr-14 sm:pl-10",
            native
              ? "max-sm:pb-6"
              : "max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]",
          )}
        >
          <Suspense fallback={<PanelLoading />}>
            <ActivePanel />
          </Suspense>
        </div>

        <SettingsSaveBar />
      </div>
    </SettingsSectionsProvider>
  )
}

function PanelLoading() {
  return (
    <div className="text-foreground-muted flex h-32 items-center justify-center">
      <Spinner />
    </div>
  )
}
