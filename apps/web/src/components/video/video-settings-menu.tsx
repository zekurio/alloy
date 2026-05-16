import { DownloadIcon, GaugeIcon, SettingsIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"

export type QualityOption = {
  id: string
  label: string
  downloadUrl?: string
  selectable?: boolean
}

const glassMenuClass =
  "rounded-xl border-white/10 !bg-black/45 text-foreground shadow-[0_8px_24px_-12px_rgb(0_0_0_/_0.9)] backdrop-blur-sm"

const glassMenuItemClass =
  "text-foreground/80 transition-colors focus:bg-transparent focus:text-accent data-highlighted:bg-transparent data-highlighted:text-accent [&_svg]:text-foreground/70 focus:[&_svg]:text-accent data-highlighted:[&_svg]:text-accent"

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

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
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
        {hasQualityChoices || hasDownloads ? (
          <DropdownMenuGroup>
            {hasQualityChoices ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className={glassMenuItemClass}>
                  <GaugeIcon />
                  {selectedQuality?.label ?? "Quality"}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  data-video-shortcut-scope="ignore"
                  alignOffset={-3}
                  side="left"
                  sideOffset={4}
                  portalContainer={portalContainer}
                  className={glassMenuClass}
                >
                  {selectableOptions.map((quality) => (
                    <DropdownMenuItem
                      key={quality.id}
                      className={glassMenuItemClass}
                      onClick={() => onSelectQuality?.(quality.id)}
                    >
                      <QualityText quality={quality} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}

            {hasDownloads ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className={glassMenuItemClass}>
                  <DownloadIcon />
                  Download
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  data-video-shortcut-scope="ignore"
                  alignOffset={-3}
                  side="left"
                  sideOffset={4}
                  portalContainer={portalContainer}
                  className={glassMenuClass}
                >
                  {downloadOptions.map((quality) => (
                    <DropdownMenuItem
                      key={quality.id}
                      className={glassMenuItemClass}
                      onClick={() => startDownload(quality.downloadUrl!)}
                    >
                      {quality.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
          </DropdownMenuGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function QualityText({ quality }: { quality: QualityOption }) {
  return <span className="truncate">{quality.label}</span>
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
