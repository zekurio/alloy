import { t } from "@alloy/i18n"
import { AppMainColumn } from "@alloy/ui/components/app-shell"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@alloy/ui/components/avatar"
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
import { List, ListItemButton } from "@alloy/ui/components/list"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { ScrollArea } from "@alloy/ui/components/scroll-area"
import { useIsMobile } from "@alloy/ui/hooks/use-mobile"
import { cn } from "@alloy/ui/lib/utils"
import { useBlocker } from "@tanstack/react-router"
import { ArrowLeftIcon, SearchIcon, XIcon } from "lucide-react"
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { mobileSurfaceCloseButtonClassName } from "@/components/app/mobile-close-button"
import { avatarTint } from "@/components/layout/account-menu"
import { AdminConfigProvider } from "@/components/routes/settings/admin-config-context"
import { DesktopRecordingProvider } from "@/components/routes/settings/desktop/desktop-recording-context"
import { SettingsBuildInfo } from "@/components/routes/settings/settings-build-info"
import {
  type SettingsCategory,
  SETTINGS_GROUPS,
  useSettingsCategories,
} from "@/components/routes/settings/settings-categories"
import {
  selectSettingsDirty,
  SettingsSaveProvider,
  useSettingsSave,
} from "@/components/routes/settings/settings-save-context"
import { SettingsSaveHeader } from "@/components/routes/settings/settings-save-header"
import { searchSettingsCategories } from "@/components/routes/settings/settings-search"
import { SettingsSectionNav } from "@/components/routes/settings/settings-section-nav"
import { SettingsSectionsProvider } from "@/components/routes/settings/settings-sections-context"
import { useSuspenseSession } from "@/lib/session-suspense"
import { useUserChipData } from "@/lib/user-display"

interface SettingsNavigation {
  /** Switch sections in place, as the sidebar does. */
  onNavigate: (section: string) => void
  /** Open a section from the phone overview. */
  onOpenSection: (section: string) => void
  /** Leave a section for the phone overview. */
  onBack: () => void
}

interface SettingsDialogProps extends SettingsNavigation {
  section: string | null
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

/**
 * Fetches the code of every visible lazy panel once the browser is idle, so
 * opening settings, even straight onto a lazy section from the desktop tray,
 * renders the panel without a loading fallback.
 */
function usePreloadSettingsPanels(categories: SettingsCategory[]) {
  useEffect(() => {
    const preload = () => {
      for (const category of categories) {
        void category.Panel.preload?.().catch(() => {})
      }
    }
    // Safari has no requestIdleCallback.
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(preload, { timeout: 3000 })
      return () => window.cancelIdleCallback(handle)
    }
    const timer = setTimeout(preload, 1500)
    return () => clearTimeout(timer)
  }, [categories])
}

/**
 * Leaving with unsaved edits is blocked however it is attempted, including the
 * browser's back button and the back gesture phones use to leave a section.
 */
function useBlockUnsavedNavigation() {
  const dirty = useSettingsSave(selectSettingsDirty)
  const requestAttention = useSettingsSave((state) => state.requestAttention)
  useBlocker({
    disabled: !dirty,
    enableBeforeUnload: dirty,
    shouldBlockFn: () => {
      requestAttention()
      return true
    },
  })
}

function SettingsPageRoot() {
  const categories = useSettingsCategories()
  const [section, setSection] = useState<string | null>(null)
  useBlockUnsavedNavigation()
  usePreloadSettingsPanels(categories)

  if (categories.length === 0) return null

  return (
    <AppMainColumn className="bg-surface flex-row max-md:pb-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom))]">
      <SettingsProviders categories={categories}>
        <SettingsDialogContent
          native
          categories={categories}
          section={section}
          onNavigate={setSection}
          onOpenSection={setSection}
          onBack={() => setSection(null)}
        />
      </SettingsProviders>
    </AppMainColumn>
  )
}

function SettingsDialogRoot({
  section,
  onNavigate,
  onOpenSection,
  onBack,
  onClose,
}: SettingsDialogProps) {
  const categories = useSettingsCategories()
  const open = section !== null && categories.length > 0
  // Holds the last section while the dialog animates closed.
  const [visibleSection, setVisibleSection] = useState(section)
  if (section !== null && section !== visibleSection) {
    setVisibleSection(section)
  }

  const dirty = useSettingsSave(selectSettingsDirty)
  const requestAttention = useSettingsSave((state) => state.requestAttention)
  useBlockUnsavedNavigation()
  // Mounted while closed too, so the panels are ready before it first opens.
  usePreloadSettingsPanels(categories)

  const body =
    categories.length > 0 ? (
      <SettingsDialogContent
        categories={categories}
        section={section ?? visibleSection}
        onNavigate={onNavigate}
        onOpenSection={onOpenSection}
        onBack={onBack}
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
          "settings-sheet max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-h-none max-md:w-screen max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0",
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
  section,
  onNavigate,
  onOpenSection,
  onBack,
}: SettingsNavigation & {
  native?: boolean
  categories: SettingsCategory[]
  /** Requested section id; anything that is not a category means "none". */
  section: string | null
}) {
  const isMobile = useIsMobile()
  const requested = categories.find((category) => category.id === section)
  // A phone has room for the menu or a section, never both, so without a
  // section it shows the menu. Wider layouts always pair the sidebar with one.
  const active = requested ?? (isMobile ? null : categories[0])

  if (!active) {
    return (
      <SettingsOverview
        native={native}
        categories={categories}
        onOpenSection={onOpenSection}
      />
    )
  }

  return (
    <SettingsSectionView
      native={native}
      isMobile={isMobile}
      categories={categories}
      active={active}
      onNavigate={onNavigate}
      onBack={onBack}
    />
  )
}

const MOBILE_HEADER_TITLE_CLASS_NAME =
  "grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center"

/**
 * Title bar for the phone layout: one button, then the title centred. In a
 * section it gives way to the unsaved-changes banner while a form is dirty.
 * The overview has no forms, so it keeps a plain header; otherwise a save
 * that just finished would cover its title and close button.
 */
function SettingsMobileHeader({
  title,
  leading,
  saveBanner = false,
}: {
  title: string
  leading: ReactNode
  saveBanner?: boolean
}) {
  const content = (
    <>
      <div className="grid place-items-center">{leading}</div>
      <h2 className="text-foreground truncate text-center text-base font-semibold tracking-[var(--tracking-tight)]">
        {title}
      </h2>
    </>
  )
  if (!saveBanner) {
    return (
      <header
        className={cn(
          "border-border bg-background h-13 shrink-0 border-b px-1",
          MOBILE_HEADER_TITLE_CLASS_NAME,
        )}
      >
        {content}
      </header>
    )
  }
  return (
    <SettingsSaveHeader
      className="h-13 px-1"
      titleClassName={MOBILE_HEADER_TITLE_CLASS_NAME}
      bannerClassName="px-3"
      compact
    >
      {content}
    </SettingsSaveHeader>
  )
}

/**
 * The phone's settings menu: search, the signed-in profile, then every section
 * grouped the way the sidebar groups them.
 */
function SettingsOverview({
  native,
  categories,
  onOpenSection,
}: {
  native: boolean
  categories: SettingsCategory[]
  onOpenSection: (section: string) => void
}) {
  const search = useSettingsSearch(categories)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <SettingsMobileHeader
        title={t("Settings")}
        leading={
          native ? null : (
            <DialogClose
              aria-label={t("Close settings")}
              className={mobileSurfaceCloseButtonClassName}
            >
              <XIcon />
            </DialogClose>
          )
        }
      />
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5",
          !native && "pb-[max(1.25rem,env(safe-area-inset-bottom))]",
        )}
      >
        <SettingsSearchField value={search.query} onChange={search.setQuery} />
        {search.groups.map((group) => {
          const profile = group.items.find(
            (item) => item.category.id === "profile",
          )
          const rest = group.items.filter(
            (item) => item.category.id !== "profile",
          )
          return (
            <section key={group.id} className="flex flex-col gap-4">
              {group.id !== "account" ? (
                <h3 className="text-foreground-faint -mb-2 px-1 pt-1 text-sm font-medium">
                  {group.label}
                </h3>
              ) : null}
              {profile ? (
                <List>
                  <SettingsOverviewProfileRow
                    hint={profile.hint}
                    onOpen={() => onOpenSection(profile.category.id)}
                  />
                </List>
              ) : null}
              {rest.length > 0 ? (
                <List>
                  {rest.map(({ category, hint }) => {
                    const Icon = category.icon
                    return (
                      <ListItemButton
                        key={category.id}
                        className="min-h-12 py-2"
                        onClick={() => onOpenSection(category.id)}
                      >
                        <Icon className="text-foreground-muted size-4.5 shrink-0" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-md truncate font-medium">
                            {category.label}
                          </span>
                          {hint ? (
                            <span className="text-foreground-dim truncate text-sm">
                              {hint}
                            </span>
                          ) : null}
                        </span>
                      </ListItemButton>
                    )
                  })}
                </List>
              ) : null}
            </section>
          )
        })}
        {search.groups.length === 0 ? (
          <p className="text-foreground-faint px-1 text-sm">
            {t("No settings found.")}
          </p>
        ) : null}
        <SettingsBuildInfo className="px-1" />
      </div>
    </div>
  )
}

/** The profile section's row on the overview, shown as the account it edits. */
function SettingsOverviewProfileRow({
  hint,
  onOpen,
}: {
  hint: string | null
  onOpen: () => void
}) {
  const session = useSuspenseSession()
  const chip = useUserChipData(session?.user)

  return (
    <ListItemButton className="min-h-16" onClick={onOpen}>
      <Avatar
        size="lg"
        className="!size-10 shrink-0"
        style={avatarTint(chip.avatar)}
      >
        {chip.avatar.src ? <AvatarImage src={chip.avatar.src} alt="" /> : null}
        <AvatarFallback style={avatarTint(chip.avatar)} />
      </Avatar>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-md truncate font-semibold">{chip.name}</span>
        <span className="text-foreground-dim truncate text-sm">
          {hint ?? t("Edit profile")}
        </span>
      </span>
    </ListItemButton>
  )
}

function SettingsSectionView({
  native,
  isMobile,
  categories,
  active,
  onNavigate,
  onBack,
}: {
  native: boolean
  isMobile: boolean
  categories: SettingsCategory[]
  active: SettingsCategory
  onNavigate: (section: string) => void
  onBack: () => void
}) {
  const ActivePanel = active.Panel
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const dirty = useSettingsSave(selectSettingsDirty)
  const requestAttention = useSettingsSave((state) => state.requestAttention)
  // Leaving a section unmounts its panel and would silently drop its edits,
  // so it gets the same unsaved-changes guard as closing.
  const guarded = (leave: () => void) => {
    if (dirty) {
      requestAttention()
      return
    }
    leave()
  }
  const navigateTo = (sectionId: string) => {
    if (sectionId === active.id) return
    guarded(() => onNavigate(sectionId))
  }
  const search = useSettingsSearch(categories)
  const title = active.title ?? active.label
  // Sections share one scroller; a new one starts at its top rather than
  // wherever the last one was left.
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [active.id])

  return (
    <SettingsSectionsProvider>
      <ScrollArea
        render={<nav />}
        className="border-border bg-background hidden w-64 shrink-0 border-r md:flex"
        viewportClassName="flex flex-col gap-1 p-5"
      >
        <div className="text-foreground px-2.5 pb-3 text-lg font-semibold tracking-[var(--tracking-tight)]">
          {t("Settings")}
        </div>
        <SettingsSearchField
          value={search.query}
          onChange={search.setQuery}
          className="mb-1"
          iconClassName="size-3.5"
        />
        {search.groups.map((group) => (
          <div key={group.id} className="flex flex-col gap-0.5">
            {group.id !== "account" ? (
              <div className="text-foreground-faint px-2.5 pt-5 pb-1.5 text-xs font-medium">
                {group.label}
              </div>
            ) : null}
            {group.items.map(({ category, hint }) => {
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
                        <span className="text-foreground-faint truncate text-xs font-normal">
                          {hint}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  {/* Searching filters the list down to what matched; the
                        subsections of one tab would only bury that. */}
                  {isActive && !search.query.trim() ? (
                    <SettingsSectionNav scrollRef={scrollRef} />
                  ) : null}
                </div>
              )
            })}
          </div>
        ))}
        {search.groups.length === 0 ? (
          <p className="text-foreground-faint px-2.5 pt-3 text-sm">
            {t("No settings found.")}
          </p>
        ) : null}
        <SettingsBuildInfo className="mt-auto px-2.5 pt-8" />
      </ScrollArea>

      {/* On a phone a section replaces the menu, so it pushes in over it. */}
      <div className="max-md:animate-in max-md:fade-in-0 max-md:slide-in-from-right-4 animation-duration-200 flex min-w-0 flex-1 flex-col motion-reduce:animate-none">
        {/* Discord-style title bar: the section name stays pinned while the
            panel below it scrolls, and turns into the save banner while
            edits are unsaved. A phone gets the way back to the menu in it;
            wider layouts have the sidebar for that and get the close button
            instead. */}
        {isMobile ? (
          <SettingsMobileHeader
            title={title}
            saveBanner
            leading={
              <button
                type="button"
                aria-label={t("Go back")}
                className={mobileSurfaceCloseButtonClassName}
                onClick={() => guarded(onBack)}
              >
                <ArrowLeftIcon />
              </button>
            }
          />
        ) : (
          <SettingsSaveHeader
            className="px-10 py-3"
            titleClassName="flex items-center justify-between gap-4"
          >
            <h2 className="text-foreground truncate text-xl font-semibold tracking-[var(--tracking-tight)]">
              {title}
            </h2>
            {native ? null : (
              <DialogClose
                aria-label={t("Close settings")}
                className="text-foreground-muted hover:text-foreground focus-visible:ring-ring ml-auto grid size-7 shrink-0 place-items-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <XIcon className="size-4" />
              </DialogClose>
            )}
          </SettingsSaveHeader>
        )}

        <ScrollArea
          className="flex-1"
          viewportRef={scrollRef}
          viewportClassName={cn(
            "px-5 py-6 md:px-10 md:py-8",
            native
              ? "max-md:pb-6"
              : "max-md:pb-[max(1.5rem,env(safe-area-inset-bottom))]",
          )}
        >
          {/* Keyed so each section fades in rather than snapping over the
              last one. */}
          <div
            key={active.id}
            className="animate-in fade-in-0 animation-duration-[var(--duration-base)] motion-reduce:animate-none"
          >
            <Suspense fallback={<LoadingState variant="panel" />}>
              <ActivePanel />
            </Suspense>
          </div>
        </ScrollArea>
      </div>
    </SettingsSectionsProvider>
  )
}

/** The settings search query and what it matches, grouped as the nav groups. */
function useSettingsSearch(categories: SettingsCategory[]) {
  const [query, setQuery] = useState("")
  const groups = useMemo(() => {
    const matches = searchSettingsCategories(categories, query)
    return SETTINGS_GROUPS.map((group) => ({
      ...group,
      items: matches.filter((match) => match.category.group === group.id),
    })).filter((group) => group.items.length > 0)
  }, [categories, query])
  return { query, setQuery, groups }
}

function SettingsSearchField({
  value,
  onChange,
  className,
  iconClassName,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
  iconClassName?: string
}) {
  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <SearchIcon className={iconClassName} />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={t("Search settings")}
        aria-label={t("Search settings")}
        className="[&::-webkit-search-cancel-button]:appearance-none"
      />
    </InputGroup>
  )
}
