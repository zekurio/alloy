import type { DesktopUpdateState } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Spinner } from "@alloy/ui/components/spinner"
import { DownloadIcon, RefreshCcwIcon, ServerIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { alloyDesktop } from "@/lib/desktop"

interface DesktopBridgeRecoveryProps {
  actual: number
  expected: number
}

export function DesktopBridgeRecovery(props: DesktopBridgeRecoveryProps) {
  if (props.actual > props.expected) {
    return <ServerUpdateRequired {...props} />
  }
  return <DesktopUpdateRequired {...props} />
}

function DesktopUpdateRequired(props: DesktopBridgeRecoveryProps) {
  const desktop = alloyDesktop()
  const [state, setState] = useState<DesktopUpdateState | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!desktop) return
    void desktop.updates.getState().then(setState).catch(setRecoveryError)
    return desktop.updates.onState(setState)
  }, [desktop])

  function setRecoveryError() {
    setError(t("Automatic update failed. Download the installer to continue."))
    setPending(false)
  }

  async function updateDesktop() {
    if (!desktop || pending) return
    setError(null)
    setPending(true)
    try {
      const next = await runDesktopUpdate(desktop, state)
      setState(next)
      if (next.status === "idle") {
        setError(t("No compatible desktop update was found."))
      }
      if (next.status !== "downloaded") setPending(false)
    } catch {
      setRecoveryError()
    }
  }

  const busy =
    pending || state?.status === "checking" || state?.status === "downloading"
  const downloaded = state?.status === "downloaded"

  return (
    <RecoveryScreen
      icon={downloaded ? <RefreshCcwIcon /> : <DownloadIcon />}
      title={t("Desktop update required")}
      detail={t(
        "This server needs desktop bridge {expected}, but this app has bridge {actual}. Update Alloy Desktop to continue.",
        { actual: props.actual, expected: props.expected },
      )}
      error={error}
    >
      <Button
        type="button"
        className="w-full justify-center"
        disabled={busy}
        onClick={() => void updateDesktop()}
      >
        {busy ? (
          <Spinner />
        ) : downloaded ? (
          <RefreshCcwIcon />
        ) : (
          <DownloadIcon />
        )}
        {busy
          ? state?.status === "downloading"
            ? t("Downloading update...")
            : t("Checking for updates...")
          : downloaded
            ? t("Install and restart")
            : error
              ? t("Try again")
              : t("Update Alloy Desktop")}
      </Button>
      <ManualInstallerLink />
    </RecoveryScreen>
  )
}

function ServerUpdateRequired(props: DesktopBridgeRecoveryProps) {
  return (
    <RecoveryScreen
      icon={<ServerIcon />}
      title={t("Server update required")}
      detail={t(
        "This desktop app has bridge {actual}, but this server supports bridge {expected}. Update the Alloy server, then reload this page.",
        { actual: props.actual, expected: props.expected },
      )}
      error={null}
    >
      <Button
        type="button"
        className="w-full justify-center"
        onClick={() => window.location.reload()}
      >
        <RefreshCcwIcon />
        {t("Reload server app")}
      </Button>
    </RecoveryScreen>
  )
}

function RecoveryScreen(props: {
  icon: React.ReactNode
  title: string
  detail: string
  error: string | null
  children: React.ReactNode
}) {
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-8">
      <section className="w-full max-w-md text-center">
        <div className="bg-accent/12 text-accent mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl [&_svg]:size-6">
          {props.icon}
        </div>
        <h1 className="text-xl font-semibold">{props.title}</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          {props.detail}
        </p>
        {props.error ? (
          <p className="text-destructive mt-3 text-sm" role="alert">
            {props.error}
          </p>
        ) : null}
        <div className="mt-7 flex flex-col gap-3">{props.children}</div>
      </section>
    </main>
  )
}

function ManualInstallerLink() {
  return (
    <a
      className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
      href="https://github.com/zekurio/alloy/releases/latest"
      target="_blank"
      rel="noreferrer"
    >
      {t("Download the installer manually")}
    </a>
  )
}

async function runDesktopUpdate(
  desktop: NonNullable<ReturnType<typeof alloyDesktop>>,
  current: DesktopUpdateState | null,
): Promise<DesktopUpdateState> {
  const checked =
    current?.status === "available" || current?.status === "downloaded"
      ? current
      : await desktop.updates.checkForUpdates()
  const downloaded =
    checked.status === "available"
      ? await desktop.updates.downloadUpdate()
      : checked
  if (downloaded.status === "downloaded") {
    await desktop.updates.restartToInstall()
  }
  return downloaded
}
