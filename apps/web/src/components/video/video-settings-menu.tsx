import { DownloadIcon, SettingsIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Switch } from "@workspace/ui/components/switch"

export function VideoSettingsMenu({
  qualityOptions = [],
  selectedQualityId,
  onSelectQuality,
  downloadOptions = [],
  autoAdvance,
  onAutoAdvanceChange,
  triggerClassName,
  triggerStyle,
  contentClassName,
  contentStyle,
}: {
  qualityOptions?: Array<{ id: string; label: string }>
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
  downloadOptions?: Array<{ id: string; label: string; url: string }>
  autoAdvance?: boolean
  onAutoAdvanceChange?: (next: boolean) => void
  triggerClassName?: string
  triggerStyle?: React.CSSProperties
  contentClassName?: string
  contentStyle?: React.CSSProperties
}) {
  const hasQualityChoices =
    qualityOptions.length > 1 && Boolean(onSelectQuality)
  const hasDownloads = downloadOptions.length > 0
  const hasAutoAdvance = typeof autoAdvance === "boolean"
  if (!hasQualityChoices && !hasDownloads && !hasAutoAdvance) return null

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
        {hasAutoAdvance ? (
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={(event) => {
                event.preventDefault()
                onAutoAdvanceChange?.(!autoAdvance)
              }}
              className="justify-between gap-6 pr-3"
            >
              Autoplay next
              <Switch
                size="sm"
                checked={autoAdvance}
                onCheckedChange={onAutoAdvanceChange}
                onClick={(event) => event.stopPropagation()}
                aria-label="Autoplay next"
              />
            </DropdownMenuItem>
          </DropdownMenuGroup>
        ) : null}

        {hasAutoAdvance && (hasQualityChoices || hasDownloads) ? (
          <DropdownMenuSeparator />
        ) : null}

        {hasQualityChoices ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Quality</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={selectedQualityId}
              onValueChange={onSelectQuality}
            >
              {qualityOptions.map((quality) => (
                <DropdownMenuRadioItem key={quality.id} value={quality.id}>
                  {quality.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        ) : null}

        {hasQualityChoices && hasDownloads ? <DropdownMenuSeparator /> : null}

        {hasDownloads ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <DownloadIcon />
              Download
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {downloadOptions.map((download) => (
                <DropdownMenuItem
                  key={download.id}
                  onClick={() => startDownload(download.url)}
                >
                  {download.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
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
