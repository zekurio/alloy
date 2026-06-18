import { Button } from "@alloy/ui/components/button"
import { FolderOpenIcon } from "lucide-react"

import { useDesktopRecording } from "./desktop-recording-context"
import { formatBytes } from "./desktop-recording-helpers"

export function DesktopStorageSettings({
  disabled: disabledProp = false,
}: {
  disabled?: boolean
}) {
  const { settings, storageInfo, busy, chooseOutputFolder } =
    useDesktopRecording()
  if (!settings || !storageInfo) return null

  const disabled = disabledProp || busy
  const folder = settings.outputFolder || storageInfo.outputFolder
  const { totalBytes, usedBytes, availableBytes, clipsBytes } = storageInfo
  const otherBytes = Math.max(0, usedBytes - clipsBytes)
  const pct = (value: number) =>
    totalBytes > 0 ? `${(value / totalBytes) * 100}%` : "0%"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Capture folder</span>
        <div className="flex items-center gap-2">
          <div className="border-border bg-input text-foreground-dim flex h-9 min-w-0 flex-1 items-center truncate rounded-lg border px-3 text-sm sm:h-8">
            {folder}
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => void chooseOutputFolder()}
          >
            <FolderOpenIcon className="size-3.5" />
            Change
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">Disk usage</span>
          <span className="text-foreground-dim text-xs">
            {formatBytes(availableBytes)} free of {formatBytes(totalBytes)}
          </span>
        </div>

        <div className="bg-surface-raised flex h-2.5 w-full overflow-hidden rounded-full">
          <div
            className="bg-foreground-muted/60 h-full"
            style={{ width: pct(otherBytes) }}
          />
          <div
            className="bg-accent h-full"
            style={{ width: pct(clipsBytes) }}
          />
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          <UsageLegend
            className="bg-foreground-muted/60"
            label="System"
            value={formatBytes(otherBytes)}
          />
          <UsageLegend
            className="bg-accent"
            label="Clips"
            value={formatBytes(clipsBytes)}
          />
          <UsageLegend
            className="bg-surface-raised"
            label="Available"
            value={formatBytes(availableBytes)}
          />
        </div>
      </div>
    </div>
  )
}

function UsageLegend({
  className,
  label,
  value,
}: {
  className: string
  label: string
  value: string
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2.5 rounded-full ${className}`} />
      <span className="text-foreground-dim">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  )
}
