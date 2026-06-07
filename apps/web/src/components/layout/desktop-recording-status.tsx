import { Button } from "alloy-ui/components/button"
import { MonitorCogIcon } from "lucide-react"

import { alloyDesktop } from "@/lib/desktop"

export function DesktopRecordingStatus() {
  const desktop = alloyDesktop()
  if (!desktop) return null

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      title="Open desktop settings"
      className="hidden md:inline-flex"
      onClick={() => void desktop.openSettings()}
    >
      <MonitorCogIcon className="size-4" />
      Desktop
    </Button>
  )
}
