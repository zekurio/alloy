import {
  DESKTOP_UPDATE_CHANNELS,
  normalizeDesktopUpdateChannel,
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
import { DownloadIcon, RefreshCcwIcon } from "lucide-react"
import { useState } from "react"

import {
  rememberDesktopUpdateChannel,
  useDesktopUpdateChannel,
  useDesktopUpdateChannelLoading,
  useDesktopUpdateState,
} from "@/lib/desktop-updates"

import { alloyDesktop } from "./desktop-bridge"

type Phase = "idle" | "saving" | "restarting"

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
  const busy = phase === "saving"

  async function changeChannel(value: DesktopUpdateChannel | null) {
    const nextChannel = normalizeDesktopUpdateChannel(value)
    if (!activeUpdates.setChannel || !nextChannel || nextChannel === channel) {
      return
    }

    setPhase("saving")
    try {
      const savedChannel = await activeUpdates.setChannel(nextChannel)
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

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border rounded-md border px-3 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{t("Update channel")}</div>
            <div className="text-foreground-dim mt-0.5 text-xs">
              {channel ? (
                CHANNEL_SUMMARIES[channel]
              ) : channelLoading ? (
                <Skeleton className="h-3 w-24" />
              ) : (
                t("Desktop releases")
              )}
            </div>
          </div>

          {canConfigure && channel ? (
            <Select
              value={channel}
              onValueChange={changeChannel}
              disabled={busy}
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
            <span className="text-foreground-faint text-xs">
              {t("Unavailable in this build")}
            </span>
          )}
        </div>
      </div>

      <div className="border-border bg-surface-raised/40 flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={updateState.status} />
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {updateStatusTitle(updateState.status)}
            </div>
            <p className="text-foreground-dim truncate text-xs">
              {updateStatusDetails(updateState.version)}
            </p>
          </div>
        </div>

        {updateState.status === "downloaded" ? (
          <Button
            type="button"
            size="sm"
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
          <span className="text-foreground-faint inline-flex items-center gap-1.5 text-xs">
            {phase === "saving" ? (
              <Spinner />
            ) : (
              <DownloadIcon className="size-3.5" />
            )}
            {phase === "saving" ? t("Saving") : t("Background checks")}
          </span>
        )}
      </div>
    </div>
  )
}

function StatusDot({
  status,
}: {
  status: ReturnType<typeof useDesktopUpdateState>["status"]
}) {
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

function updateStatusTitle(
  status: ReturnType<typeof useDesktopUpdateState>["status"],
): string {
  switch (status) {
    case "checking":
      return t("Checking for updates")
    case "downloading":
      return t("Downloading update")
    case "downloaded":
      return t("Update ready")
    case "idle":
      return t("Updates ready in the background")
  }
}

function updateStatusDetails(version: string | null): string {
  return version
    ? t("Version {version}", { version })
    : t("No downloaded update")
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
