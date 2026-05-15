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
}

/** Blurred dropdown content shared across the settings root and its
 *  sub-menus. The alloy-blur tokens are retuned to match the chrome bar so
 *  the menu reads as the same material — slightly darker because dropdowns
 *  often land on bright video. */
const glassMenuClass =
  "alloy-blur border-white/10 text-foreground [--alloy-blur-bg:rgb(8_8_10_/_0.88)] [--alloy-blur-blur:24px] [--alloy-blur-border:rgb(255_255_255_/_0.08)] [--alloy-blur-shadow:0_18px_48px_-20px_rgb(0_0_0_/_0.7)]"

export function VideoSettingsMenu({
  qualityOptions = [],
  selectedQualityId,
  onSelectQuality,
  onOpenChange,
  triggerClassName,
  triggerStyle,
  contentClassName,
  contentStyle,
  portalContainer,
}: {
  qualityOptions?: QualityOption[]
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
  /** Fires when the menu opens/closes — used by the chrome bar to keep
   *  itself visible while the user is interacting with the menu. */
  onOpenChange?: (open: boolean) => void
  triggerClassName?: string
  triggerStyle?: React.CSSProperties
  contentClassName?: string
  contentStyle?: React.CSSProperties
  portalContainer?: HTMLElement | null
}) {
  const hasQualityChoices =
    qualityOptions.length > 1 && Boolean(onSelectQuality)
  const downloadOptions = qualityOptions.filter((q) => q.downloadUrl)
  const hasDownloads = downloadOptions.length > 0
  const selectedQuality =
    qualityOptions.find((quality) => quality.id === selectedQualityId) ??
    qualityOptions[0]
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
            <SettingsIcon strokeWidth={1.5} />
          </Button>
        }
      />
      <DropdownMenuContent
        data-video-shortcut-scope="ignore"
        align="end"
        sideOffset={8}
        className={cn(glassMenuClass, contentClassName)}
        style={contentStyle}
        portalContainer={portalContainer}
      >
        {hasQualityChoices || hasDownloads ? (
          <DropdownMenuGroup>
            {hasQualityChoices ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <GaugeIcon />
                  {selectedQuality?.label ?? "Quality"}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  data-video-shortcut-scope="ignore"
                  alignOffset={-3}
                  portalContainer={portalContainer}
                  className={glassMenuClass}
                >
                  {qualityOptions.map((quality) => (
                    <DropdownMenuItem
                      key={quality.id}
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
                <DropdownMenuSubTrigger>
                  <DownloadIcon />
                  Download
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  data-video-shortcut-scope="ignore"
                  alignOffset={-3}
                  portalContainer={portalContainer}
                  className={glassMenuClass}
                >
                  {downloadOptions.map((quality) => (
                    <DropdownMenuItem
                      key={quality.id}
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
