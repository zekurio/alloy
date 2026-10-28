import type { DesktopShortcutsState } from "@alloy/contracts/desktop"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { SettingRow, SettingRows } from "@alloy/ui/components/setting-row"
import { Spinner } from "@alloy/ui/components/spinner"
import { fieldControlClassName } from "@alloy/ui/lib/field-control"
import { cn } from "@alloy/ui/lib/utils"
import { KeyboardIcon, RotateCcwIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { SettingsSubsection } from "@/components/routes/settings/settings-panel"
import { alloyDesktop } from "@/lib/desktop"
import { useActionFeedback } from "@/lib/use-action-feedback"

/**
 * The shortcuts the desktop bound, kept current from "shortcuts" events.
 * Null outside a shell that binds them, or until the first answer.
 */
function useDesktopShortcuts(): [
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
 * portal). The desktop owns the keys, so they are shown rather than edited,
 * and changed in the desktop's own settings.
 */
export function GlobalShortcutsSection() {
  const recording = alloyDesktop()?.recording ?? null
  const [state, setState] = useDesktopShortcuts()
  const { feedback, run } = useActionFeedback()

  if (!recording || !state?.supported) return <ShortcutCommandsHint />

  const trigger = (id: string) =>
    state.shortcuts.find((shortcut) => shortcut.id === id)?.trigger ?? ""
  const pending = feedback.state === "pending"

  return (
    <SettingsSubsection id="hotkeys" title={t("Hotkeys")}>
      <SettingRows>
        <SettingRow
          title={t("Screenshot")}
          description={t("Saves the current game or display as a PNG.")}
        >
          <ShortcutTrigger
            trigger={trigger("screenshot")}
            binding={state.binding}
          />
        </SettingRow>
        <SettingRow
          title={t("Clip")}
          description={t("Saves the configured replay buffer.")}
        >
          <ShortcutTrigger trigger={trigger("clip")} binding={state.binding} />
        </SettingRow>
        <SettingRow
          title={t("Shortcut keys")}
          description={
            <>
              {state.error
                ? t(state.error)
                : state.configurable
                  ? t(
                      "Your desktop owns these keys. Change them in its settings.",
                    )
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
              {pending ? <Spinner /> : <KeyboardIcon className="size-3.5" />}
              {t("Change shortcuts")}
            </Button>
          ) : null}
        </SettingRow>
      </SettingRows>
      {state.error ? <ShortcutCommandsHint inline /> : null}
    </SettingsSubsection>
  )
}

function ShortcutTrigger({
  trigger,
  binding,
}: {
  trigger: string
  binding: boolean
}) {
  return (
    <span
      className={cn(
        fieldControlClassName,
        "inline-flex h-9 min-w-28 items-center justify-center px-3 font-mono text-xs font-medium sm:h-8",
        !trigger && "text-foreground-faint font-sans",
      )}
    >
      {binding ? <Spinner /> : trigger || t("Not set")}
    </span>
  )
}

/**
 * Where the desktop can't bind shortcuts, its own keyboard settings can run
 * the app with an action instead.
 */
function ShortcutCommandsHint({ inline = false }: { inline?: boolean }) {
  const hint = (
    <p className={cn("text-foreground-dim text-xs", inline && "mt-3")}>
      {t(
        "Without a shortcut portal, bind {clip} and {screenshot} in your desktop's keyboard settings instead.",
        {
          clip: "alloy-desktop --action clip",
          screenshot: "alloy-desktop --action screenshot",
        },
      )}
    </p>
  )
  if (inline) return hint
  return (
    <SettingsSubsection id="hotkeys" title={t("Hotkeys")}>
      {hint}
    </SettingsSubsection>
  )
}
