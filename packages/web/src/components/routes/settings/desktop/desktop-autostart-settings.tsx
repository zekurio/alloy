import type { DesktopAutostartState } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Skeleton } from "@alloy/ui/components/skeleton"
import { Switch } from "@alloy/ui/components/switch"
import { toast } from "@alloy/ui/lib/toast"
import { useState } from "react"

import { useDesktopQuery } from "@/lib/use-desktop-query"

import { alloyDesktop } from "./desktop-bridge"

export function DesktopAutostartSettings() {
  const autostart = alloyDesktop()?.autostart
  const { data: state, setData: setState } = useDesktopQuery(
    autostart
      ? () =>
          autostart.getState().catch(
            (): DesktopAutostartState => ({
              supported: false,
              enabled: false,
            }),
          )
      : null,
    [autostart],
  )
  const [busy, setBusy] = useState(false)

  if (!autostart) return null
  const activeAutostart = autostart

  async function toggle(enabled: boolean) {
    setBusy(true)
    try {
      setState(await activeAutostart.setEnabled(enabled))
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : t("Couldn't update the startup setting."),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-border bg-surface-raised/40 rounded-md border px-3 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {t("Start Alloy when you sign in")}
          </div>
          <p className="text-foreground-dim mt-0.5 text-xs">
            {t(
              "Launches in the background so your games are captured right away.",
            )}
          </p>
        </div>
        {state === undefined ? (
          <Skeleton className="h-5 w-9 rounded-full" />
        ) : state.supported ? (
          <Switch
            checked={state.enabled}
            disabled={busy}
            onCheckedChange={(enabled) => void toggle(enabled)}
          />
        ) : (
          <span className="text-foreground-faint shrink-0 text-xs">
            {t("Unavailable in this build")}
          </span>
        )}
      </div>
    </div>
  )
}
