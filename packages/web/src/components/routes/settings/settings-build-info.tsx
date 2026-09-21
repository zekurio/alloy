import { t } from "@alloy/i18n"
import { cn } from "@alloy/ui/lib/utils"

import { alloyDesktop } from "@/lib/desktop"
import { useDesktopUpdateState } from "@/lib/desktop-updates"

import { version as webVersion } from "../../../../../../package.json"

/** Keep the loaded web build distinct from the independently updated host. */
export function SettingsBuildInfo({ className }: { className?: string }) {
  const { currentVersion } = useDesktopUpdateState()

  return (
    <div
      className={cn(
        "text-foreground-dim text-xs leading-relaxed break-words",
        className,
      )}
    >
      {alloyDesktop() && currentVersion ? (
        <p>{t("Alloy Desktop {version}", { version: currentVersion })}</p>
      ) : null}
      <p>{t("Alloy Web {version}", { version: webVersion })}</p>
    </div>
  )
}
