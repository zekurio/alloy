import {
  DESKTOP_UPDATE_CHANNELS,
  normalizeDesktopUpdateChannel,
  type DesktopUpdateChannel,
} from "@alloy/contracts"
import { Button } from "@alloy/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@alloy/ui/components/select"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { DownloadIcon, RefreshCcwIcon } from "lucide-react"
import * as React from "react"

import { useDesktopUpdateState } from "@/lib/desktop-updates"

import { alloyDesktop } from "./desktop-bridge"

type Phase = "loading" | "idle" | "saving" | "restarting"

const CHANNEL_LABELS: Record<DesktopUpdateChannel, string> = {
  latest: "Stable",
  nightly: "Nightly",
}

const CHANNEL_SUMMARIES: Record<DesktopUpdateChannel, string> = {
  latest: "Release builds",
  nightly: "Nightly builds",
}

export function DesktopUpdateSettings() {
  const updates = alloyDesktop()?.updates
  const updateState = useDesktopUpdateState()
  const [channel, setChannel] = React.useState<DesktopUpdateChannel | null>(
    null,
  )
  const [phase, setPhase] = React.useState<Phase>("loading")

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      if (!updates?.getChannel) {
        setPhase("idle")
        return
      }

      setPhase("loading")
      try {
        const loadedChannel = await updates.getChannel()
        if (!cancelled) setChannel(loadedChannel)
      } catch (cause) {
        if (!cancelled) {
          toast.error(errorText(cause, "Couldn't load update settings."))
        }
      } finally {
        if (!cancelled) setPhase("idle")
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [updates])

  if (!updates) return null
  const activeUpdates = updates

  const canConfigure =
    typeof activeUpdates.getChannel === "function" &&
    typeof activeUpdates.setChannel === "function"
  const busy = phase === "loading" || phase === "saving"

  async function changeChannel(value: DesktopUpdateChannel | null) {
    const nextChannel = normalizeDesktopUpdateChannel(value)
    if (!activeUpdates.setChannel || !nextChannel || nextChannel === channel) {
      return
    }

    setPhase("saving")
    try {
      const savedChannel = await activeUpdates.setChannel(nextChannel)
      setChannel(savedChannel)
      toast.success(`Update channel set to ${CHANNEL_LABELS[savedChannel]}.`)
    } catch (cause) {
      toast.error(errorText(cause, "Couldn't save update channel."))
    } finally {
      setPhase("idle")
    }
  }

  async function restartToInstall() {
    setPhase("restarting")
    try {
      await activeUpdates.restartToInstall()
    } catch (cause) {
      toast.error(errorText(cause, "Couldn't restart to update."))
      setPhase("idle")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="border-border rounded-md border px-3 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Update channel</div>
            <p className="text-foreground-dim mt-0.5 text-xs">
              {channel ? CHANNEL_SUMMARIES[channel] : "Desktop releases"}
            </p>
          </div>

          {canConfigure ? (
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
                <SelectValue>
                  {channel ? CHANNEL_LABELS[channel] : "Loading"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {DESKTOP_UPDATE_CHANNELS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {CHANNEL_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-foreground-faint text-xs">
              Unavailable in this build
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
                Restarting...
              </>
            ) : (
              <>
                <RefreshCcwIcon className="size-3.5" />
                Restart
              </>
            )}
          </Button>
        ) : (
          <span className="text-foreground-faint inline-flex items-center gap-1.5 text-xs">
            {phase === "loading" || phase === "saving" ? (
              <Spinner />
            ) : (
              <DownloadIcon className="size-3.5" />
            )}
            {phase === "saving" ? "Saving" : "Background checks"}
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
      return "Checking for updates"
    case "downloading":
      return "Downloading update"
    case "downloaded":
      return "Update ready"
    case "idle":
      return "Updates ready in the background"
  }
}

function updateStatusDetails(version: string | null): string {
  return version ? `Version ${version}` : "No downloaded update"
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
