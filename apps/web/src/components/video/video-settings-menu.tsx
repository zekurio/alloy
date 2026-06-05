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
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@workspace/ui/components/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { useMediaQuery } from "@workspace/ui/hooks/use-media-query"
import { cn } from "@workspace/ui/lib/utils"

import {
  mobileDrawerContentClass,
  MobileDrawerHandle,
} from "@/components/app/mobile-drawer-surface"
import { startBrowserDownload } from "@/lib/browser-download"

import type { QualityOption } from "./video-player-types"

type DownloadableQualityOption = QualityOption & { downloadUrl: string }

const glassMenuClass =
  "!w-[min(300px,calc(var(--available-width,100vw)-8px))] min-w-[min(220px,calc(var(--available-width,100vw)-8px))] max-w-[calc(var(--available-width,100vw)-8px)] rounded-xl border-white/[0.08] bg-popover/[0.88] p-0 text-foreground shadow-[0_18px_48px_-24px_rgb(0_0_0_/_0.55)] backdrop-blur-xl"

// Touch devices get a YouTube-style bottom sheet instead of an anchored popup.
const sheetContentClass = cn(
  mobileDrawerContentClass,
  "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
)

const panelClass =
  "max-h-[min(460px,calc(var(--available-height,100vh)-8px))] overflow-y-auto p-1.5"

const sheetPanelClass = "max-h-[70dvh] overflow-y-auto px-2 pt-1 pb-2"

const iconClass = "shrink-0 text-foreground/80"

type SettingsView = "main" | "quality" | "download"

interface SettingsBodyProps {
  selectableOptions: QualityOption[]
  hasQualityChoices: boolean
  downloadOptions: DownloadableQualityOption[]
  singleDownload: DownloadableQualityOption | null
  selectedQuality?: QualityOption
  onSelectQuality?: (qualityId: string) => void
}

interface VideoSettingsMenuProps extends SettingsBodyTriggerProps {
  qualityOptions?: QualityOption[]
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
  onOpenChange?: (open: boolean) => void
  contentClassName?: string
  contentStyle?: React.CSSProperties
  portalContainer?: HTMLElement | null
}

interface SettingsBodyTriggerProps {
  triggerClassName?: string
  triggerIconClassName?: string
  triggerStyle?: React.CSSProperties
}

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
}: VideoSettingsMenuProps) {
  const isCoarsePointer = useMediaQuery("(pointer: coarse)")

  const selectableOptions = qualityOptions.filter(
    (quality) => quality.selectable !== false,
  )
  const hasQualityChoices = selectableOptions.length > 1 &&
    Boolean(onSelectQuality)
  const downloadOptions = qualityOptions.filter(hasDownloadUrl)
  const selectedQuality =
    selectableOptions.find((quality) => quality.id === selectedQualityId) ??
      selectableOptions[0]
  if (!hasQualityChoices && downloadOptions.length === 0) return null

  // A single download variant collapses into a direct action — no submenu.
  const singleDownload = downloadOptions.length === 1
    ? downloadOptions[0]
    : null

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Settings"
      className={triggerClassName}
      style={triggerStyle}
    >
      <SettingsIcon className={triggerIconClassName} />
    </Button>
  )

  const body: SettingsBodyProps = {
    selectableOptions,
    hasQualityChoices,
    downloadOptions,
    singleDownload,
    selectedQuality,
    onSelectQuality,
  }

  if (isCoarsePointer) {
    return (
      <SettingsSheet
        trigger={trigger}
        onOpenChange={onOpenChange}
        portalContainer={portalContainer}
        body={body}
      />
    )
  }

  return (
    <SettingsDropdown
      trigger={trigger}
      onOpenChange={onOpenChange}
      contentClassName={contentClassName}
      contentStyle={contentStyle}
      portalContainer={portalContainer}
      body={body}
    />
  )
}

function SettingsDropdown({
  trigger,
  onOpenChange,
  contentClassName,
  contentStyle,
  portalContainer,
  body,
}: {
  trigger: React.ReactElement
  onOpenChange?: (open: boolean) => void
  contentClassName?: string
  contentStyle?: React.CSSProperties
  portalContainer?: HTMLElement | null
  body: SettingsBodyProps
}) {
  const [view, setView] = React.useState<SettingsView>("main")

  function handleOpenChange(open: boolean) {
    if (!open) setView("main")
    onOpenChange?.(open)
  }

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent
        data-video-shortcut-scope="ignore"
        align="end"
        side="top"
        sideOffset={4}
        className={cn(glassMenuClass, contentClassName)}
        style={contentStyle}
        portalContainer={portalContainer}
      >
        <SettingsBody dense view={view} setView={setView} {...body} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SettingsSheet({
  trigger,
  onOpenChange,
  portalContainer,
  body,
}: {
  trigger: React.ReactElement
  onOpenChange?: (open: boolean) => void
  portalContainer?: HTMLElement | null
  body: SettingsBodyProps
}) {
  const [open, setOpen] = React.useState(false)
  const [view, setView] = React.useState<SettingsView>("main")

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setView("main")
    onOpenChange?.(next)
  }

  const close = React.useCallback(() => setOpen(false), [])

  return (
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
      direction="bottom"
      handleOnly
    >
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent
        data-video-shortcut-scope="ignore"
        container={portalContainer}
        className={sheetContentClass}
      >
        <DrawerTitle className="sr-only">Player settings</DrawerTitle>
        <MobileDrawerHandle />
        <SettingsBody
          view={view}
          setView={setView}
          closeOnAction
          close={close}
          {...body}
        />
      </DrawerContent>
    </Drawer>
  )
}

function SettingsBody({
  view,
  setView,
  dense = false,
  closeOnAction = false,
  close,
  selectableOptions,
  hasQualityChoices,
  downloadOptions,
  singleDownload,
  selectedQuality,
  onSelectQuality,
}: SettingsBodyProps & {
  view: SettingsView
  setView: (view: SettingsView) => void
  dense?: boolean
  closeOnAction?: boolean
  close?: () => void
}) {
  const handleSelectQuality = (qualityId: string) => {
    onSelectQuality?.(qualityId)
    if (closeOnAction) close?.()
  }
  const handleDownload = (url: string) => {
    startDownload(url)
    if (closeOnAction) close?.()
  }

  if (view === "quality") {
    return (
      <QualitySettingsView
        dense={dense}
        options={selectableOptions}
        selectedQualityId={selectedQuality?.id}
        onBack={() => setView("main")}
        onSelectQuality={handleSelectQuality}
      />
    )
  }

  if (view === "download") {
    return (
      <DownloadSettingsView
        dense={dense}
        options={downloadOptions}
        onBack={() => setView("main")}
        onDownload={handleDownload}
      />
    )
  }

  return (
    <MainSettingsView
      dense={dense}
      selectedQuality={selectedQuality}
      hasQualityChoices={hasQualityChoices}
      downloadOptions={downloadOptions}
      singleDownload={singleDownload}
      onQualityClick={() => setView("quality")}
      onDownloadClick={() => setView("download")}
      onDirectDownload={handleDownload}
    />
  )
}

function MainSettingsView({
  dense,
  selectedQuality,
  hasQualityChoices,
  downloadOptions,
  singleDownload,
  onQualityClick,
  onDownloadClick,
  onDirectDownload,
}: {
  dense: boolean
  selectedQuality?: QualityOption
  hasQualityChoices: boolean
  downloadOptions: DownloadableQualityOption[]
  singleDownload: DownloadableQualityOption | null
  onQualityClick: () => void
  onDownloadClick: () => void
  onDirectDownload: (url: string) => void
}) {
  return (
    <div className={dense ? panelClass : sheetPanelClass}>
      {hasQualityChoices
        ? (
          <MenuRow
            dense={dense}
            icon={<GaugeIcon className={iconCls(dense)} />}
            label="Quality"
            value={qualitySummary(selectedQuality)}
            onClick={onQualityClick}
            showChevron
          />
        )
        : null}

      {singleDownload
        ? (
          <MenuRow
            dense={dense}
            icon={<DownloadIcon className={iconCls(dense)} />}
            label="Download"
            onClick={() => onDirectDownload(singleDownload.downloadUrl)}
          />
        )
        : downloadOptions.length > 1
        ? (
          <MenuRow
            dense={dense}
            icon={<DownloadIcon className={iconCls(dense)} />}
            label="Download"
            value="Choose version"
            onClick={onDownloadClick}
            showChevron
          />
        )
        : null}
    </div>
  )
}

function QualitySettingsView({
  dense,
  options,
  selectedQualityId,
  onBack,
  onSelectQuality,
}: {
  dense: boolean
  options: QualityOption[]
  selectedQualityId?: string
  onBack: () => void
  onSelectQuality?: (qualityId: string) => void
}) {
  return (
    <div className={dense ? panelClass : sheetPanelClass}>
      <PanelHeader dense={dense} title="Quality" onBack={onBack} />
      <div>
        {options.map((quality) => {
          const selected = quality.id === selectedQualityId
          return (
            <button
              key={quality.id}
              type="button"
              className={cn(
                rowClass(dense),
                selected &&
                  "bg-white/20 text-foreground focus-visible:bg-white/25",
              )}
              onClick={() => onSelectQuality?.(quality.id)}
            >
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center",
                  dense ? "w-6" : "w-7",
                )}
              >
                {selected ? <CheckIcon className={iconCls(dense)} /> : null}
              </span>
              <QualityLabel quality={quality} showDetail={false} />
              {selected && quality.selectionLabel
                ? (
                  <span className="max-w-[50%] min-w-0 truncate text-right text-foreground/60">
                    {quality.selectionLabel}
                  </span>
                )
                : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DownloadSettingsView({
  dense,
  options,
  onBack,
  onDownload,
}: {
  dense: boolean
  options: DownloadableQualityOption[]
  onBack: () => void
  onDownload: (url: string) => void
}) {
  return (
    <div className={dense ? panelClass : sheetPanelClass}>
      <PanelHeader dense={dense} title="Download" onBack={onBack} />
      <div>
        {options.map((quality) => (
          <button
            key={quality.id}
            type="button"
            className={rowClass(dense)}
            onClick={() => onDownload(quality.downloadUrl)}
          >
            <span
              className={cn(
                "flex shrink-0 items-center justify-center",
                dense ? "w-6" : "w-7",
              )}
            >
              <DownloadIcon className={iconCls(dense)} />
            </span>
            <QualityLabel quality={quality} showDetail={false} />
          </button>
        ))}
      </div>
    </div>
  )
}

function PanelHeader({
  dense,
  title,
  onBack,
}: {
  dense: boolean
  title: string
  onBack: () => void
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-2.5",
        dense ? "h-8" : "h-11 gap-3 px-3",
      )}
    >
      <button
        type="button"
        className={cn(
          "grid shrink-0 place-items-center rounded-md text-foreground/90 transition-colors outline-none hover:bg-white/15 focus-visible:bg-white/15",
          dense ? "size-6" : "size-8",
        )}
        aria-label="Back"
        onClick={onBack}
      >
        <ChevronLeftIcon className={iconCls(dense)} />
      </button>
      <span
        className={cn(
          "min-w-0 truncate font-semibold text-foreground",
          dense ? "text-sm" : "text-base",
        )}
      >
        {title}
      </span>
    </div>
  )
}

function MenuRow({
  dense,
  icon,
  label,
  value,
  onClick,
  showChevron = false,
}: {
  dense: boolean
  icon: React.ReactNode
  label: string
  value?: string
  onClick: () => void
  showChevron?: boolean
}) {
  return (
    <button type="button" className={rowClass(dense)} onClick={onClick}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value
        ? (
          <span className="max-w-[55%] min-w-0 truncate text-right text-foreground/60">
            {value}
          </span>
        )
        : null}
      {showChevron
        ? (
          <ChevronRightIcon
            className={cn(iconCls(dense), "text-foreground/60")}
          />
        )
        : null}
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
        showDetail ? "flex-col gap-0.5" : "items-center",
      )}
    >
      <span className="truncate text-foreground">{quality.label}</span>
      {showDetail && quality.detail
        ? (
          <span className="truncate text-xs text-foreground/55">
            {quality.detail}
          </span>
        )
        : null}
    </span>
  )
}

function rowClass(dense: boolean): string {
  return cn(
    "flex w-full items-center rounded-md text-left text-foreground/90 outline-none transition-colors hover:bg-white/15 focus-visible:bg-white/15",
    dense
      ? "min-h-8 gap-2.5 px-2.5 text-sm"
      : "min-h-12 gap-3 rounded-lg px-3 text-base active:bg-white/15",
  )
}

function iconCls(dense: boolean): string {
  return cn(iconClass, dense ? "size-4" : "size-5")
}

function qualitySummary(quality: QualityOption | undefined): string {
  if (!quality) return "Unavailable"
  if (quality.selectionLabel) {
    return `${quality.label} - ${quality.selectionLabel}`
  }
  return quality.label
}

function hasDownloadUrl(
  quality: QualityOption,
): quality is DownloadableQualityOption {
  return (
    typeof quality.downloadUrl === "string" &&
    quality.downloadUrl.trim().length > 0
  )
}

function startDownload(url: string): void {
  startBrowserDownload(url, { rel: "noopener" })
}
