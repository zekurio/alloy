import type { DesktopUpdateState, DesktopUpdateStatus } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Card } from "@alloy/ui/components/card"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { RefreshCcwIcon, SearchIcon } from "lucide-react"
import { useState } from "react"

import { useDesktopUpdateState } from "@/lib/desktop-updates"

import { alloyDesktop } from "./desktop-bridge"

type Phase = "idle" | "checking" | "restarting"

export function DesktopUpdateSettings() {
  const updates = alloyDesktop()?.updates
  const updateState = useDesktopUpdateState()
  const [phase, setPhase] = useState<Phase>("idle")

  if (!updates) return null
  const activeUpdates = updates

  const canCheck = typeof activeUpdates.checkForUpdates === "function"
  const checkBusy = phase === "checking" || updateState.status === "checking"
  const checkDisabled =
    !canCheck ||
    phase !== "idle" ||
    updateState.status === "checking" ||
    updateState.status === "downloading"

  async function restartToInstall() {
    setPhase("restarting")
    try {
      await activeUpdates.restartToInstall()
    } catch (cause) {
      toast.error(errorText(cause, t("Couldn't restart to update.")))
      setPhase("idle")
    }
  }

  async function checkForUpdates() {
    if (!activeUpdates.checkForUpdates) return

    setPhase("checking")
    try {
      const state = await activeUpdates.checkForUpdates()
      if (state.status === "idle") {
        toast.success(t("No updates found."))
      }
    } catch (cause) {
      toast.error(errorText(cause, t("Couldn't check for updates.")))
    } finally {
      setPhase("idle")
    }
  }

  return (
    <Card className="flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusDot status={updateState.status} />
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {updateStatusTitle(updateState.status)}
          </div>
          <div className="text-foreground-dim mt-0.5 truncate text-xs">
            {updateVersionSummary(updateState)}
          </div>
        </div>
      </div>

      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
        {updateState.status === "downloaded" ? (
          <Button
            type="button"
            size="sm"
            className="w-full sm:w-auto"
            disabled={phase === "restarting"}
            onClick={() => void restartToInstall()}
          >
            {phase === "restarting" ? (
              <>
                <Spinner />
                {t("Restarting...")}
              </>
            ) : (
              <>
                <RefreshCcwIcon className="size-3.5" />
                {t("Restart")}
              </>
            )}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full sm:w-auto"
            disabled={checkDisabled}
            onClick={() => void checkForUpdates()}
          >
            {checkBusy ? (
              <>
                <Spinner />
                {t("Checking...")}
              </>
            ) : updateState.status === "downloading" ? (
              <>
                <Spinner />
                {t("Downloading...")}
              </>
            ) : (
              <>
                <SearchIcon className="size-3.5" />
                {t("Check for updates")}
              </>
            )}
          </Button>
        )}
      </div>
    </Card>
  )
}

function StatusDot({ status }: { status: DesktopUpdateStatus }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "downloaded"
          ? "bg-success"
          : status === "checking" || status === "downloading"
            ? "bg-accent"
            : "bg-foreground-dim",
      )}
    />
  )
}

function updateStatusTitle(status: DesktopUpdateStatus): string {
  switch (status) {
    case "checking":
      return t("Checking for updates")
    case "downloading":
      return t("Downloading update")
    case "downloaded":
      return t("Update ready")
    case "idle":
      return t("Updates")
  }
}

function updateVersionSummary(state: DesktopUpdateState): string {
  if (state.currentVersion && state.version) {
    return t("{currentVersion} -> {version}", {
      currentVersion: state.currentVersion,
      version: state.version,
    })
  }

  if (state.currentVersion) {
    return t("Current version {version}", { version: state.currentVersion })
  }

  if (state.version) {
    return t("Version {version}", { version: state.version })
  }

  return t("Desktop releases")
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
