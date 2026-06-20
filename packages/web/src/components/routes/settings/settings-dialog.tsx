import { t as tx } from "@alloy/i18n"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@alloy/ui/components/dialog"
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
import { SearchIcon, XIcon } from "lucide-react"
import * as React from "react"

import { mobileSurfaceCloseButtonClassName } from "@/components/app/mobile-close-button"
import { AdminConfigProvider } from "@/components/routes/settings/admin-config-context"
import { DesktopRecordingProvider } from "@/components/routes/settings/desktop/desktop-recording-context"
import {
  type SettingsCategory,
  SETTINGS_GROUPS,
  useSettingsCategories,
} from "@/components/routes/settings/settings-categories"
import { SettingsPanel } from "@/components/routes/settings/settings-panel"
import { SettingsSaveBar } from "@/components/routes/settings/settings-save-bar"
import {
  SettingsSaveProvider,
  useSettingsSaveState,
} from "@/components/routes/settings/settings-save-context"

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

function SettingsDialogRoot({
  section,
  onNavigate,
  onClose,
}: SettingsDialogProps) {
  const categories = useSettingsCategories()
  const open = section !== null && categories.length > 0
  const [visibleSection, setVisibleSection] = React.useState(section)
  React.useEffect(() => {
    if (section !== null) setVisibleSection(section)
  }, [section])

  const { dirty, requestAttention } = useSettingsSaveState()

  const activeSection = section ?? visibleSection
  const active =
    categories.find((category) => category.id === activeSection) ??
    categories[0]
  const hasAdmin = categories.some((category) => category.group === "admin")
  const hasDesktop = categories.some((category) => category.group === "desktop")

  let body = active ? (
    <SettingsDialogContent
      categories={categories}
      active={active}
      onNavigate={onNavigate}
    />
  ) : null
  if (body && hasAdmin) body = <AdminConfigProvider>{body}</AdminConfigProvider>
  if (body && hasDesktop)
    body = <DesktopRecordingProvider>{body}</DesktopRecordingProvider>

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
        <DialogTitle className="sr-only">{tx("Settings")}</DialogTitle>
        {body}
        <DialogClose
          aria-label={tx("Close settings")}
          className={cn(
            mobileSurfaceCloseButtonClassName,
            "absolute top-2 right-2 z-10 sm:top-3 sm:right-3",
          )}
        >
          <XIcon />
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}

function SettingsDialogContent({
  categories,
  active,
  onNavigate,
}: {
  categories: SettingsCategory[]
  active: SettingsCategory
  onNavigate: (section: string) => void
}) {
  const ActivePanel = active.Panel
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
  const [query, setQuery] = React.useState("")
  const normalized = query.trim().toLowerCase()
  const matches = React.useMemo<
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
    <>
      <nav className="border-border bg-background hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r p-4 sm:flex">
        <div className="text-foreground px-2.5 pb-2 text-lg font-semibold tracking-[var(--tracking-tight)]">
          {tx("Settings")}
        </div>
        <div className="relative mb-1">
          <SearchIcon className="text-foreground-faint pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={tx("Search settings")}
            aria-label={tx("Search settings")}
            className="border-border bg-background placeholder:text-foreground-faint focus-visible:border-accent-border focus-visible:ring-accent-border/20 h-9 w-full rounded-lg border pr-2 pl-8 text-sm outline-none focus-visible:ring-2 sm:h-8 [&::-webkit-search-cancel-button]:appearance-none"
          />
        </div>
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
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => navigateTo(category.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
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
                )
              })}
            </div>
          )
        })}
        {matches.length === 0 ? (
          <p className="text-foreground-faint px-2.5 pt-3 text-sm">
            {tx("No settings found.")}
          </p>
        ) : null}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-border bg-background border-b sm:hidden">
          <div className="text-foreground px-4 pt-3 pr-12 pb-2 text-lg font-semibold tracking-[var(--tracking-tight)]">
            {tx("Settings")}
          </div>
          <div className="px-4 pb-3">
            <Select
              value={active.id}
              onValueChange={(value) => {
                if (value) navigateTo(value)
              }}
            >
              <SelectTrigger
                aria-label={tx("Settings sections")}
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
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:py-7 sm:pr-12 sm:pl-8">
          <SettingsPanel
            title={active.title ?? active.label}
            description={active.description}
          >
            <React.Suspense fallback={<PanelLoading />}>
              <ActivePanel />
            </React.Suspense>
          </SettingsPanel>
        </div>

        <SettingsSaveBar />
      </div>
    </>
  )
}

function PanelLoading() {
  return (
    <div className="text-foreground-muted flex h-32 items-center justify-center">
      <Spinner />
    </div>
  )
}
