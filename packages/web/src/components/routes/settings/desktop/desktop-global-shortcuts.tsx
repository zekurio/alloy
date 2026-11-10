import type { DesktopShortcutsState } from "@alloy/contracts/desktop"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { Spinner } from "@alloy/ui/components/spinner"
import { ExternalLinkIcon, RotateCcwIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { alloyDesktop } from "@/lib/desktop"
import { useActionFeedback } from "@/lib/use-action-feedback"

/**
 * The shortcuts the desktop bound, kept current from "shortcuts" events.
 * Null outside the desktop app, or until the first answer.
 */
export function useDesktopShortcuts(): [
  DesktopShortcutsState | null,
  (state: DesktopShortcutsState) => void,
] {
  const recording = alloyDesktop()?.recording ?? null
  const [state, setState] = useState<DesktopShortcutsState | null>(null)

  useEffect(() => {
    if (!recording) return
    let cancelled = false
    let received = false
    const unsubscribe = recording.onEvent((event) => {
      if (event.type !== "shortcuts") return
      received = true
      setState(event.state)
    })
    void recording.getShortcuts().then(
      (latest) => {
        if (!cancelled && !received) setState(latest)
      },
      () => undefined,
    )
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [recording])

  return [state, setState]
}

/**
 * Hotkeys where the desktop binds them (Linux, through its GlobalShortcuts
 * portal). The desktop owns the keys, so they are changed in its own
 * settings. The keys are not shown here: the portal describes them in its
 * own words and language, such as GNOME's "Press <Control>F8", and that
 * sentence can't be reduced to a key name.
 */
export function GlobalShortcutsSection({
  state,
  setState,
}: {
  state: DesktopShortcutsState
  setState: (state: DesktopShortcutsState) => void
}) {
  const recording = alloyDesktop()?.recording ?? null
  const { feedback, run } = useActionFeedback()

  if (!recording) return null

  const pending = feedback.state === "pending"

  return (
    <SettingsSubsection id="hotkeys" title={t("Hotkeys")}>
      <SettingRows>
        <SettingRow
          title={t("Screenshot and clip keys")}
          description={
            <>
              {state.error
                ? t(state.error)
                : state.configurable
                  ? t("Your desktop owns these keys.")
                  : t(
                      "Your desktop owns these keys. Change them in its keyboard settings.",
                    )}
              {feedback.state === "error" ? (
                <span role="alert" className="text-destructive mt-1 block">
                  {feedback.message}
                </span>
              ) : null}
            </>
          }
        >
          {state.error ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending || state.binding}
              onClick={() =>
                void run(async () => {
                  setState(await recording.bindShortcuts())
                }, t("Couldn't set up the shortcuts with your desktop."))
              }
            >
              {pending ? <Spinner /> : <RotateCcwIcon className="size-3.5" />}
              {t("Set up again")}
            </Button>
          ) : state.configurable ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending || state.binding}
              onClick={() =>
                void run(
                  () => recording.configureShortcuts(),
                  t("Couldn't open your desktop's shortcut settings."),
                )
              }
            >
              {t("Change in system settings")}
              {pending || state.binding ? (
                <Spinner />
              ) : (
                <ExternalLinkIcon className="size-3.5" />
              )}
            </Button>
          ) : null}
        </SettingRow>
      </SettingRows>
      {state.error ? <ShortcutCommandsHint /> : null}
    </SettingsSubsection>
  )
}

/**
 * Where the desktop can't bind shortcuts, its own keyboard settings can run
 * the app with an action instead.
 */
function ShortcutCommandsHint() {
  return (
    <p className="text-foreground-dim mt-3 text-xs">
      {t(
        "Without a shortcut portal, bind {clip} and {screenshot} in your desktop's keyboard settings instead.",
        {
          clip: "alloy-desktop --action clip",
          screenshot: "alloy-desktop --action screenshot",
        },
      )}
    </p>
  )
}
