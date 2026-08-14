import type { DesktopAutostartState } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Skeleton } from "@alloy/ui/components/skeleton"
import { Switch } from "@alloy/ui/components/switch"
import { useState } from "react"

import { useDesktopQuery } from "@/lib/use-desktop-query"

import { alloyDesktop } from "./desktop-bridge"

export function DesktopAutostartSettings() {
  const desktop = alloyDesktop()
  const { data: state, setData: setState } = useDesktopQuery(
    desktop
      ? () =>
          desktop.autostart.getState().catch((): DesktopAutostartState => ({
            supported: false,
            enabled: false,
          }))
      : null,
    [desktop],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!desktop) return null
  const autostart = desktop.autostart

  async function toggle(enabled: boolean) {
    setError(null)
    setBusy(true)
    try {
      setState(await autostart.setEnabled(enabled))
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("Couldn't update the startup setting."),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingRow
      title={t("Start Alloy when you sign in")}
      description={
        <>
          {t(
            "Launches in the background so your games are captured right away.",
          )}
          {error ? (
            <span role="alert" className="text-destructive mt-1 block">
              {error}
            </span>
          ) : null}
        </>
      }
    >
      {state === undefined ? (
        <Skeleton className="h-5 w-9 rounded-full" />
      ) : state.supported ? (
        <Switch
          checked={state.enabled}
          disabled={busy}
          onCheckedChange={(enabled) => void toggle(enabled)}
        />
      ) : (
        <span className="text-foreground-dim shrink-0 text-xs">
          {t("Unavailable in this build")}
        </span>
      )}
    </SettingRow>
  )
}
