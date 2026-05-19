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
  "!w-[min(300px,calc(var(--available-width,100vw)-8px))] min-w-[min(220px,calc(var(--available-width,100vw)-8px))] max-w-[calc(var(--available-width,100vw)-8px)] rounded-xl border-white/[0.08] bg-popover/[0.88] p-0 text-foreground shadow-[0_18px_48px_-24px_rgb(0_0_0_/_0.55)] backdrop-blur-xl"

const panelClass =
  "max-h-[min(460px,calc(var(--available-height,100vh)-8px))] overflow-y-auto p-1.5"

const menuRowClass =
  "flex min-h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-foreground/90 outline-none transition-colors hover:bg-white/15 focus-visible:bg-white/15"

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
      <div>
        {options.map((quality) => {
          const selected = quality.id === selectedQualityId
          return (
            <button
              key={quality.id}
              type="button"
              className={cn(
                menuRowClass,
                selected &&
                  "bg-white/20 text-foreground focus-visible:bg-white/25"
              )}
              onClick={() => onSelectQuality?.(quality.id)}
            >
              <span className="flex w-6 shrink-0 items-center justify-center">
                {selected ? <CheckIcon className="size-4" /> : null}
              </span>
              <QualityLabel quality={quality} showDetail={false} />
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
      <div>
        {options.map((quality) => (
          <button
            key={quality.id}
            type="button"
            className={menuRowClass}
            onClick={() => onDownload(quality.downloadUrl!)}
          >
            <span className="flex w-6 shrink-0 items-center justify-center">
              <DownloadIcon className={iconClass} />
            </span>
            <QualityLabel quality={quality} showDetail={false} />
          </button>
        ))}
      </div>
    </div>
  )
}

function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex h-8 items-center gap-2.5 px-2.5">
      <button
        type="button"
        className="grid size-6 shrink-0 place-items-center rounded-md text-foreground/90 transition-colors outline-none hover:bg-white/15 focus-visible:bg-white/15"
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

function QualityLabel({
  quality,
  showDetail = true,
}: {
  quality: QualityOption
  showDetail?: boolean
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 flex-1",
        showDetail ? "flex-col gap-0.5" : "items-center"
      )}
    >
      <span className="truncate text-foreground">{quality.label}</span>
      {showDetail && quality.detail ? (
        <span className="truncate text-xs text-foreground/55">
          {quality.detail}
        </span>
      ) : null}
    </span>
  )
}

function qualitySummary(quality: QualityOption | undefined): string {
  if (!quality) return "Unavailable"
  return quality.label
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
