import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Skeleton } from "@alloy/ui/components/skeleton"
import { Switch } from "@alloy/ui/components/switch"

import { alloyDesktop } from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"
import { useActionFeedback } from "@/lib/use-action-feedback"
import { useDesktopQuery } from "@/lib/use-desktop-query"

export function DesktopAutostartSettings() {
  const desktop = alloyDesktop()
  // The host reports an unsupported platform through `supported`; a rejected
  // read is a failure to show with a retry, not "unavailable".
  const {
    data: state,
    setData: setState,
    loading,
    error: loadError,
    refetch,
  } = useDesktopQuery(desktop ? () => desktop.autostart.getState() : null, [
    desktop,
  ])
  const { feedback, run } = useActionFeedback()

  if (!desktop) return null
  const autostart = desktop.autostart

  function toggle(enabled: boolean) {
    void run(
      async () => setState(await autostart.setEnabled(enabled)),
      t("Couldn't update the startup setting."),
    )
  }

  return (
    <SettingRow
      title={t("Start Alloy when you sign in")}
      description={
        <>
          {t(
            "Launches in the background so your games are captured right away.",
          )}
          {feedback.state === "error" ? (
            <span role="alert" className="text-destructive mt-1 block">
              {feedback.message}
            </span>
          ) : state === undefined && loadError && !loading ? (
            <span role="alert" className="text-destructive mt-1 block">
              {errorMessage(loadError, t("Couldn't load the startup setting."))}
            </span>
          ) : null}
        </>
      }
    >
      {state === undefined ? (
        loadError && !loading ? (
          <Button type="button" variant="outline" size="sm" onClick={refetch}>
            {t("Try again")}
          </Button>
        ) : (
          <Skeleton className="h-5 w-9 rounded-full" />
        )
      ) : state.supported ? (
        <Switch
          checked={state.enabled}
          disabled={feedback.state === "pending"}
          onCheckedChange={toggle}
        />
      ) : (
        <span className="text-foreground-dim shrink-0 text-xs">
          {t("Unavailable in this build")}
        </span>
      )}
    </SettingRow>
  )
}
