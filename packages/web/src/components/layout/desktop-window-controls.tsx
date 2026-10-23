import { AppHeaderWindowControls } from "@alloy/ui/components/app-header"

import type { alloyWindowChrome } from "@/lib/desktop"

/** Minimize, maximize and close buttons for the desktop app's window. */
export function DesktopWindowControls({
  chrome,
  className,
}: {
  chrome: NonNullable<ReturnType<typeof alloyWindowChrome>>
  className?: string
}) {
  return (
    <AppHeaderWindowControls
      className={className}
      onMinimize={() => {
        void chrome.minimizeWindow()
      }}
      onToggleMaximize={() => {
        void chrome.toggleMaximizeWindow()
      }}
      onClose={() => {
        void chrome.closeWindow()
      }}
    />
  )
}
