import { DownloadIcon, SettingsIcon } from "lucide-react"

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

export function SettingsMenu({
  qualityOptions = [],
  selectedQualityId,
  onSelectQuality,
  downloadOptions = [],
}: {
  qualityOptions?: Array<{ id: string; label: string }>
  selectedQualityId?: string
  onSelectQuality?: (qualityId: string) => void
  downloadOptions?: Array<{ id: string; label: string; url: string }>
}) {
  const hasQualityChoices =
    qualityOptions.length > 1 && Boolean(onSelectQuality)
  const hasDownloads = downloadOptions.length > 0
  if (!hasQualityChoices && !hasDownloads) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Settings"
            className="text-foreground hover:bg-[color-mix(in_oklab,var(--neutral-900)_10%,transparent)]"
          >
            <SettingsIcon />
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={8}>
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
