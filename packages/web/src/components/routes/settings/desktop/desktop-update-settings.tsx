import {
  DESKTOP_UPDATE_CHANNELS,
  isDesktopUpdateChannel,
  type DesktopUpdateStatus,
  type DesktopUpdateChannel,
} from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { Skeleton } from "@alloy/ui/components/skeleton"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { RefreshCcwIcon, SearchIcon } from "lucide-react"
import { useState } from "react"

import {
  rememberDesktopUpdateChannel,
  useDesktopUpdateChannel,
  useDesktopUpdateChannelLoading,
  useDesktopUpdateState,
} from "@/lib/desktop-updates"

import { alloyDesktop } from "./desktop-bridge"

type Phase = "idle" | "saving" | "checking" | "restarting"

const CHANNEL_LABELS: Record<DesktopUpdateChannel, string> = {
  latest: t("Latest"),
  unstable: t("Unstable"),
}

const CHANNEL_SUMMARIES: Record<DesktopUpdateChannel, string> = {
  latest: t("Release builds"),
  unstable: t("Unstable builds"),
}

export function DesktopUpdateSettings() {
  const updates = alloyDesktop()?.updates
  const updateState = useDesktopUpdateState()
  const channel = useDesktopUpdateChannel()
  const channelLoading = useDesktopUpdateChannelLoading()
  const [phase, setPhase] = useState<Phase>("idle")

  if (!updates) return null
  const activeUpdates = updates

  const canConfigure =
    typeof activeUpdates.getChannel === "function" &&
    typeof activeUpdates.setChannel === "function"
  const canCheck = typeof activeUpdates.checkForUpdates === "function"
  const channelBusy =
    phase === "saving" ||
    updateState.status === "checking" ||
    updateState.status === "downloading"
  const checkBusy = phase === "checking" || updateState.status === "checking"
  const checkDisabled =
    !canCheck ||
    phase !== "idle" ||
    updateState.status === "checking" ||
    updateState.status === "downloading"

  async function changeChannel(value: unknown) {
    if (
      !activeUpdates.setChannel ||
      !isDesktopUpdateChannel(value) ||
      value === channel
    ) {
      return
    }

    setPhase("saving")
    try {
      const savedChannel = await activeUpdates.setChannel(value)
      rememberDesktopUpdateChannel(savedChannel)
      toast.success(
        t("Update channel set to {channel}.", {
          channel: CHANNEL_LABELS[savedChannel],
        }),
      )
    } catch (cause) {
      toast.error(errorText(cause, t("Couldn't save update channel.")))
    } finally {
      setPhase("idle")
    }
  }

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
    <div className="border-border bg-surface-raised/40 rounded-md border px-3 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <StatusDot status={updateState.status} />
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {updateStatusTitle(updateState.status)}
            </div>
            <div className="text-foreground-dim mt-0.5 truncate text-xs">
              {updateState.version ? (
                t("Version {version}", { version: updateState.version })
              ) : channel ? (
                CHANNEL_SUMMARIES[channel]
              ) : channelLoading ? (
                <Skeleton className="h-3 w-24" />
              ) : (
                t("Desktop releases")
              )}
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
          {canConfigure && channel ? (
            <Select
              value={channel}
              onValueChange={changeChannel}
              disabled={channelBusy}
            >
              <SelectTrigger
                id="desktop-update-channel"
                size="sm"
                className="w-full sm:w-40"
              >
                <SelectValue>{CHANNEL_LABELS[channel]}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {DESKTOP_UPDATE_CHANNELS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {CHANNEL_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : canConfigure && channelLoading ? (
            <Skeleton className="h-8 w-full sm:w-40" />
          ) : (
            <span className="text-foreground-faint flex h-8 items-center text-xs">
              {t("Unavailable in this build")}
            </span>
          )}

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
      </div>
    </div>
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

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
