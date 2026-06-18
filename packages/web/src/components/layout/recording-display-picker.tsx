import type { RecordingDisplay } from "@alloy/contracts"
import { t as tx } from "@alloy/i18n"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import { MonitorIcon } from "lucide-react"

export function DisplayPickerDialog({
  displays,
  loading,
  open,
  onOpenChange,
  onSelect,
}: {
  displays: RecordingDisplay[]
  loading: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (display: RecordingDisplay) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="secondary" className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tx("Choose Display")}</DialogTitle>
          <DialogDescription>
            {tx("Select the display Alloy should use for desktop capture.")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {loading ? (
            <div className="text-foreground-muted flex h-40 items-center justify-center text-sm">
              {tx("Loading displays")}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {displays.map((display) => (
                <DisplayOption
                  key={display.id}
                  display={display}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function DisplayOption({
  display,
  onSelect,
}: {
  display: RecordingDisplay
  onSelect: (display: RecordingDisplay) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(display)}
      className="border-border hover:border-border-strong overflow-hidden rounded-md border text-left transition-colors hover:bg-white/[0.03]"
    >
      <div className="bg-black">
        {display.thumbnailDataUrl ? (
          <img
            src={display.thumbnailDataUrl}
            alt=""
            className="aspect-video w-full object-cover"
          />
        ) : (
          <div className="flex aspect-video items-center justify-center">
            <MonitorIcon className="text-foreground-dim size-8" />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{display.name}</div>
          <div className="text-foreground-dim text-xs">
            {display.width} x{display.height}
          </div>
        </div>
        {display.primary ? (
          <span className="bg-accent/10 text-accent rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase">
            {tx("Primary")}
          </span>
        ) : null}
      </div>
    </button>
  )
}
