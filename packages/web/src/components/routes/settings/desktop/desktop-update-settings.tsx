import type { DesktopUpdateState, DesktopUpdateStatus } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { SettingRow } from "@alloy/ui/components/setting-row"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { DownloadIcon, RefreshCcwIcon, SearchIcon } from "lucide-react"
import { useState } from "react"

import { useDesktopUpdateState } from "@/lib/desktop-updates"

import { alloyDesktop } from "./desktop-bridge"

type Phase = "idle" | "checking" | "downloading" | "installing"

export function DesktopUpdateSettings() {
  const desktop = alloyDesktop()
  const updateState = useDesktopUpdateState()
  const [phase, setPhase] = useState<Phase>("idle")

  if (!desktop) return null
  const updates = desktop.updates

  const checkBusy = phase === "checking" || updateState.status === "checking"
  const downloadBusy =
    phase === "downloading" || updateState.status === "downloading"
  const checkDisabled = phase !== "idle" || updateState.status !== "idle"

  async function restartToInstall() {
    setPhase("installing")
    try {
      await updates.restartToInstall()
    } catch (cause) {
      toast.error(errorText(cause, t("Couldn't restart to update.")))
      setPhase("idle")
    }
  }

  async function downloadUpdate() {
    setPhase("downloading")
    try {
      await updates.downloadUpdate()
    } catch (cause) {
      toast.error(errorText(cause, t("Couldn't download the update.")))
    } finally {
      setPhase("idle")
    }
  }
  async function checkForUpdates() {
    setPhase("checking")
    try {
      const state = await updates.checkForUpdates()
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
    <SettingRow
      title={
        <span className="flex items-center gap-2">
          <StatusDot status={updateState.status} />
          {updateStatusTitle(updateState.status)}
        </span>
      }
      description={updateVersionSummary(updateState)}
    >
      {updateState.status === "downloaded" ? (
        <Button
          type="button"
          size="sm"
          disabled={phase === "installing"}
          onClick={() => void restartToInstall()}
        >
          {phase === "installing" ? (
            <>
              <Spinner />
              {t("Installing...")}
            </>
          ) : (
            <>
              <RefreshCcwIcon className="size-3.5" />
              {t("Install and restart")}
            </>
          )}
        </Button>
      ) : updateState.status === "available" ? (
        <Button
          type="button"
          size="sm"
          disabled={downloadBusy}
          onClick={() => void downloadUpdate()}
        >
          {downloadBusy ? (
            <>
              <Spinner />
              {t("Downloading...")}
            </>
          ) : (
            <>
              <DownloadIcon className="size-3.5" />
              {t("Download update")}
            </>
          )}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
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
    </SettingRow>
  )
}

function StatusDot({ status }: { status: DesktopUpdateStatus }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "downloaded"
          ? "bg-success"
          : status === "available" ||
              status === "checking" ||
              status === "downloading"
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
    case "available":
      return t("Update available")
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
