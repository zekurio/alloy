import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "alloy-ui/components/dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "alloy-ui/components/select"
import { Spinner } from "alloy-ui/components/spinner"
import { cn } from "alloy-ui/lib/utils"
import { SearchIcon, XIcon } from "lucide-react"
import * as React from "react"

import { AdminConfigProvider } from "@/components/routes/settings/admin-config-context"
import { DesktopRecordingProvider } from "@/components/routes/settings/desktop/desktop-recording-context"
import {
  type SettingsCategory,
  SETTINGS_GROUPS,
  useSettingsCategories,
} from "@/components/routes/settings/settings-categories"
import { SettingsPanel } from "@/components/routes/settings/settings-panel"

interface SettingsDialogProps {
  section: string | null
  onNavigate: (section: string) => void
  onClose: () => void
}

export function SettingsDialog({
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
        if (!next) onClose()
      }}
    >
      <DialogContent
        variant="secondary"
        disableZoom
        className="flex h-[84vh] max-h-[760px] w-[calc(100vw-2rem)] max-w-4xl gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        {body}
        <DialogClose
          aria-label="Close settings"
          className="text-foreground-dim hover:text-foreground focus-visible:ring-foreground/30 absolute top-3 right-3 z-10 inline-flex size-8 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <XIcon className="size-4" />
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
        <div className="text-foreground px-2.5 pb-1 text-sm font-semibold">
          Settings
        </div>
        <div className="relative pb-1">
          <SearchIcon className="text-foreground-faint pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            className="border-border bg-background placeholder:text-foreground-faint focus-visible:border-accent-border focus-visible:ring-accent-border/20 h-8 w-full rounded-md border pr-2 pl-8 text-sm outline-none focus-visible:ring-2 [&::-webkit-search-cancel-button]:appearance-none"
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
                    onClick={() => onNavigate(category.id)}
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
            No settings found.
          </p>
        ) : null}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-border border-b p-3 pr-14 sm:hidden">
          <Select
            value={active.id}
            onValueChange={(value) => {
              if (value !== null) onNavigate(value)
            }}
          >
            <SelectTrigger aria-label="Settings section" className="w-full">
              <SelectValue>{active.label}</SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              {SETTINGS_GROUPS.map((group) => {
                const items = categories.filter(
                  (category) => category.group === group.id,
                )
                if (items.length === 0) return null
                return (
                  <SelectGroup key={group.id}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {items.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-7 pr-12 pl-8">
          <SettingsPanel
            title={active.title ?? active.label}
            description={active.description}
          >
            <React.Suspense fallback={<PanelLoading />}>
              <ActivePanel />
            </React.Suspense>
          </SettingsPanel>
        </div>
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
