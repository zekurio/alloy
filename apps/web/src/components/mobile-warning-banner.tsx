import { TriangleAlertIcon, XIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { useIsMobile } from "@workspace/ui/hooks/use-mobile"

const STORAGE_KEY = "alloy.mobile-warning-dismissed"

export function MobileWarningBanner() {
  const isMobile = useIsMobile()
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY) === "1")
  }, [])

  if (!isMobile || dismissed) return null

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 flex items-start gap-2 border-b border-border bg-surface-raised px-3 py-2 text-xs text-foreground shadow-md"
    >
      <TriangleAlertIcon className="mt-0.5 size-4 flex-none text-warning" />
      <p className="min-w-0 flex-1 leading-normal">
        alloy isn't optimized for mobile yet — some layouts may look off. For
        the best experience, use a desktop browser.
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          localStorage.setItem(STORAGE_KEY, "1")
          setDismissed(true)
        }}
        className="-mr-1 inline-flex size-5 flex-none items-center justify-center rounded-sm text-foreground-faint hover:bg-surface hover:text-foreground"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}
