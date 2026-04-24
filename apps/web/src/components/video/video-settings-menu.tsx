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

export type QualityOption = {
  id: string
  label: string
  downloadUrl?: string
}

export function VideoSettingsMenu({
  qualityOptions = [],
  selectedQualityId,
  onSelectQuality,
  triggerClassName,
  triggerStyle,
  contentClassName,
  contentStyle,
}: {
  qualityOptions?: QualityOption[]
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
  triggerClassName?: string
  triggerStyle?: React.CSSProperties
  contentClassName?: string
  contentStyle?: React.CSSProperties
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
    <DropdownMenu>
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
        align="end"
        sideOffset={8}
        className={contentClassName}
        style={contentStyle}
      >
        {hasQualityChoices || hasDownloads ? (
          <DropdownMenuGroup>
            {hasQualityChoices ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <GaugeIcon />
                  {selectedQuality?.label ?? "Quality"}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent alignOffset={-3}>
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
                <DropdownMenuSubContent alignOffset={-3}>
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
