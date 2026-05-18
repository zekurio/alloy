import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  GaugeIcon,
  SettingsIcon,
} from "lucide-react"
import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

export type QualityOption = {
  id: string
  label: string
  detail?: string
  downloadUrl?: string
  selectable?: boolean
}

const glassMenuClass =
  "!w-[min(360px,calc(var(--available-width,100vw)-8px))] min-w-[min(260px,calc(var(--available-width,100vw)-8px))] max-w-[calc(var(--available-width,100vw)-8px)] rounded-xl border-white/10 !bg-black/70 p-0 text-foreground shadow-[0_10px_28px_-14px_rgb(0_0_0_/_0.95)] backdrop-blur-md"

const panelClass =
  "max-h-[min(460px,calc(var(--available-height,100vh)-8px))] overflow-y-auto py-1"

const menuRowClass =
  "flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm text-foreground/90 outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/10"

const iconClass = "size-4 shrink-0 text-foreground/80"

type SettingsView = "main" | "quality" | "download"

export function VideoSettingsMenu({
  qualityOptions = [],
  selectedQualityId,
  onSelectQuality,
  onOpenChange,
  triggerClassName,
  triggerIconClassName,
  triggerStyle,
  contentClassName,
  contentStyle,
  portalContainer,
}: {
  qualityOptions?: QualityOption[]
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
  onOpenChange?: (open: boolean) => void
  triggerClassName?: string
  triggerIconClassName?: string
  triggerStyle?: React.CSSProperties
  contentClassName?: string
  contentStyle?: React.CSSProperties
  portalContainer?: HTMLElement | null
}) {
  const [view, setView] = React.useState<SettingsView>("main")
  const selectableOptions = qualityOptions.filter(
    (quality) => quality.selectable !== false
  )
  const hasQualityChoices =
    selectableOptions.length > 1 && Boolean(onSelectQuality)
  const downloadOptions = qualityOptions.filter((q) => q.downloadUrl)
  const hasDownloads = downloadOptions.length > 0
  const selectedQuality =
    selectableOptions.find((quality) => quality.id === selectedQualityId) ??
    selectableOptions[0]
  if (!hasQualityChoices && !hasDownloads) return null

  function handleOpenChange(open: boolean) {
    if (!open) setView("main")
    onOpenChange?.(open)
  }

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Settings"
            className={triggerClassName}
            style={triggerStyle}
          >
            <SettingsIcon className={triggerIconClassName} />
          </Button>
        }
      />
      <DropdownMenuContent
        data-video-shortcut-scope="ignore"
        align="end"
        side="top"
        sideOffset={4}
        className={cn(glassMenuClass, contentClassName)}
        style={contentStyle}
        portalContainer={portalContainer}
      >
        {view === "main" ? (
          <MainSettingsView
            selectedQuality={selectedQuality}
            hasQualityChoices={hasQualityChoices}
            hasDownloads={hasDownloads}
            onQualityClick={() => setView("quality")}
            onDownloadClick={() => setView("download")}
          />
        ) : null}
        {view === "quality" ? (
          <QualitySettingsView
            options={selectableOptions}
            selectedQualityId={selectedQuality?.id}
            onBack={() => setView("main")}
            onSelectQuality={onSelectQuality}
          />
        ) : null}
        {view === "download" ? (
          <DownloadSettingsView
            options={downloadOptions}
            onBack={() => setView("main")}
            onDownload={startDownload}
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MainSettingsView({
  selectedQuality,
  hasQualityChoices,
  hasDownloads,
  onQualityClick,
  onDownloadClick,
}: {
  selectedQuality?: QualityOption
  hasQualityChoices: boolean
  hasDownloads: boolean
  onQualityClick: () => void
  onDownloadClick: () => void
}) {
  return (
    <div className={panelClass}>
      {hasQualityChoices ? (
        <MenuNavigationRow
          icon={<GaugeIcon className={iconClass} />}
          label="Quality"
          value={qualitySummary(selectedQuality)}
          onClick={onQualityClick}
        />
      ) : null}

      {hasDownloads ? (
        <MenuNavigationRow
          icon={<DownloadIcon className={iconClass} />}
          label="Download"
          value="Choose version"
          onClick={onDownloadClick}
        />
      ) : null}
    </div>
  )
}

function QualitySettingsView({
  options,
  selectedQualityId,
  onBack,
  onSelectQuality,
}: {
  options: QualityOption[]
  selectedQualityId?: string
  onBack: () => void
  onSelectQuality?: (qualityId: string) => void
}) {
  return (
    <div className={panelClass}>
      <PanelHeader title="Quality" onBack={onBack} />
      <div className="border-t border-white/10 py-1">
        {options.map((quality) => {
          const selected = quality.id === selectedQualityId
          return (
            <button
              key={quality.id}
              type="button"
              className={cn(menuRowClass, selected && "bg-white/10")}
              onClick={() => onSelectQuality?.(quality.id)}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {selected ? <CheckIcon className="size-4" /> : null}
              </span>
              <QualityLabel quality={quality} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DownloadSettingsView({
  options,
  onBack,
  onDownload,
}: {
  options: QualityOption[]
  onBack: () => void
  onDownload: (url: string) => void
}) {
  return (
    <div className={panelClass}>
      <PanelHeader title="Download" onBack={onBack} />
      <div className="border-t border-white/10 py-1">
        {options.map((quality) => (
          <button
            key={quality.id}
            type="button"
            className={menuRowClass}
            onClick={() => onDownload(quality.downloadUrl!)}
          >
            <DownloadIcon className={iconClass} />
            <QualityLabel quality={quality} />
          </button>
        ))}
      </div>
    </div>
  )
}

function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex h-12 items-center gap-2 px-2">
      <button
        type="button"
        className="grid size-8 shrink-0 place-items-center rounded-md text-foreground/90 transition-colors outline-none hover:bg-white/10 focus-visible:bg-white/10"
        aria-label="Back"
        onClick={onBack}
      >
        <ChevronLeftIcon className="size-4" />
      </button>
      <span className="min-w-0 truncate text-sm font-semibold text-foreground">
        {title}
      </span>
    </div>
  )
}

function MenuNavigationRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: string
  onClick: () => void
}) {
  return (
    <button type="button" className={menuRowClass} onClick={onClick}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="max-w-[55%] min-w-0 truncate text-right text-foreground/60">
        {value}
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-foreground/60" />
    </button>
  )
}

function QualityLabel({ quality }: { quality: QualityOption }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate text-foreground">{quality.label}</span>
      {quality.detail ? (
        <span className="truncate text-xs text-foreground/55">
          {quality.detail}
        </span>
      ) : null}
    </span>
  )
}

function qualitySummary(quality: QualityOption | undefined): string {
  if (!quality) return "Unavailable"
  if (!quality.detail) return quality.label
  return `${quality.label} · ${quality.detail}`
}

function startDownload(url: string): void {
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.rel = "noopener"
  anchor.style.display = "none"
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}
