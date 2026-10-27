import { DESKTOP_HTTP_CONTRACT_1 } from "@alloy/contracts"
import { t } from "@alloy/i18n"
import { DESKTOP_BRIDGE_CONTRACT_1 } from "@alloy/primitives"
import { Button } from "@alloy/ui/components/button"
import { Callout } from "@alloy/ui/components/callout"
import { ConfirmActionDialog } from "@alloy/ui/components/confirm-action-dialog"
import { ConfirmDeleteDialog } from "@alloy/ui/components/confirm-delete-dialog"
import { Input } from "@alloy/ui/components/input"
import { LoadingState } from "@alloy/ui/components/loading-state"
import { SettingRows } from "@alloy/ui/components/setting-row"
import { Spinner } from "@alloy/ui/components/spinner"
import { cn } from "@alloy/ui/lib/utils"
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleXIcon,
  LinkIcon,
  LogInIcon,
  PlusIcon,
  RefreshCcwIcon,
  Trash2Icon,
} from "lucide-react"
import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { flushSync } from "react-dom"

import {
  SettingsSections,
  SettingsSubsection,
} from "@/components/routes/settings/settings-panel"
import { alloyDesktop, type DesktopSavedServer } from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"

import { DesktopAutostartSettings } from "./desktop-autostart-settings"
import { DesktopLogSettings } from "./desktop-log-settings"
import { DesktopUpdateSettings } from "./desktop-update-settings"

type ServerApi = NonNullable<ReturnType<typeof alloyDesktop>>["servers"]

type SavedServers = ReturnType<typeof useSavedServers>

export function DesktopAppPanel() {
  const desktop = alloyDesktop()
  const serverApi = desktop?.servers
  const saved = useSavedServers(serverApi)

  if (!serverApi) return null
  // Only the first load hides the panel. A reload keeps the servers section
  // mounted so the typed address, errors and an in-flight connect survive.
  if (!saved.loaded) return <LoadingState variant="panel" />

  return (
    <SettingsSections>
      <SettingsSubsection
        id="servers"
        title={t("Servers")}
        description={t(
          "Add, switch between, or forget connected Alloy servers.",
        )}
      >
        <ServerSettings serverApi={serverApi} saved={saved} />
      </SettingsSubsection>
      <SettingsSubsection
        id="startup"
        title={t("Startup & updates")}
        description={t("Control launch behavior and desktop app updates.")}
      >
        <SettingRows>
          <DesktopAutostartSettings />
          <DesktopUpdateSettings />
        </SettingRows>
      </SettingsSubsection>
      {desktop ? (
        <SettingsSubsection id="diagnostics" title={t("Diagnostics")}>
          <SettingRows>
            <DesktopLogSettings />
          </SettingRows>
        </SettingsSubsection>
      ) : null}
    </SettingsSections>
  )
}

/** The host's saved servers and the current one, re-read on demand. */
function useSavedServers(serverApi: ServerApi | undefined) {
  const [servers, setServers] = useState<DesktopSavedServer[]>([])
  const [currentServerUrl, setCurrentServerUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  useEffect(() => {
    const api = serverApi
    if (!api) return
    let cancelled = false

    const load = async () => {
      setLoadError(null)
      setLoading(true)
      try {
        const [savedServers, currentServer] = await Promise.all([
          api.list(),
          api.current(),
        ])
        if (cancelled) return
        setServers(savedServers)
        setCurrentServerUrl(currentServer)
      } catch (cause) {
        if (!cancelled) {
          setLoadError(errorMessage(cause, t("Couldn't load servers.")))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setLoaded(true)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [serverApi, reloadNonce])

  return {
    servers,
    setServers,
    currentServerUrl,
    loading,
    loaded,
    loadError,
    reload: () => setReloadNonce((nonce) => nonce + 1),
  }
}

function ServerSettings({
  serverApi,
  saved,
}: {
  serverApi: ServerApi
  saved: SavedServers
}) {
  const { servers, setServers, currentServerUrl, loading, loadError, reload } =
    saved
  const [url, setUrl] = useState("")
  const [connectingServerUrl, setConnectingServerUrl] = useState<string | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [serverToConnect, setServerToConnect] = useState<string | null>(null)
  const [serverToForget, setServerToForget] = useState<string | null>(null)
  const [forgetting, setForgetting] = useState(false)
  const [forgetError, setForgetError] = useState<string | null>(null)
  const busy = connectingServerUrl !== null

  async function connectTo(serverUrl: string, confirmed = false) {
    const nextUrl = serverUrl.trim()
    if (!nextUrl || busy) return
    if (
      !confirmed &&
      currentServerUrl !== null &&
      !sameOrigin(nextUrl, currentServerUrl)
    ) {
      setServerToConnect(nextUrl)
      return
    }
    setError(null)
    setServerToConnect(null)

    flushSync(() => setConnectingServerUrl(nextUrl))
    try {
      // On success the host replaces this window with the new server's
      // window, so there is nothing left to update here.
      await serverApi.switchTo(nextUrl)
      setUrl("")
    } catch (cause) {
      setError(errorMessage(cause, t("Couldn't connect to server.")))
    } finally {
      setConnectingServerUrl(null)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    await connectTo(url)
  }

  async function forgetServer(serverUrl: string) {
    if (busy || forgetting) return
    setForgetError(null)
    setForgetting(true)
    try {
      setServers(await serverApi.forget(serverUrl))
      setServerToForget(null)
    } catch (cause) {
      setForgetError(errorMessage(cause, t("Couldn't forget server.")))
    } finally {
      setForgetting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Callout tone="destructive" className="text-xs">
          <CircleAlertIcon />
          <span>{error}</span>
        </Callout>
      ) : null}
      <ServerConnectForm
        url={url}
        busy={busy}
        connectingServerUrl={connectingServerUrl}
        setUrl={setUrl}
        onSubmit={handleSubmit}
      />

      <div className="border-border border-t pt-4">
        {loadError ? (
          // A failed read says nothing about saved servers, so don't follow
          // it with "No saved servers yet."
          <Callout tone="destructive" className="text-xs">
            <CircleAlertIcon />
            <div className="flex flex-1 items-center justify-between gap-3">
              <span>{loadError}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={reload}
              >
                <RefreshCcwIcon />
                {t("Try again")}
              </Button>
            </div>
          </Callout>
        ) : loading ? (
          <LoadingState variant="panel" />
        ) : (
          <SavedServerList
            servers={servers}
            currentServerUrl={currentServerUrl}
            connectingServerUrl={connectingServerUrl}
            busy={busy}
            connectTo={connectTo}
            forgetServer={(serverUrl) => {
              setForgetError(null)
              setServerToForget(serverUrl)
            }}
          />
        )}
      </div>
      <ConfirmActionDialog
        open={serverToConnect !== null}
        onOpenChange={(open) => {
          if (!open) setServerToConnect(null)
        }}
        title={t("Connect to another Alloy server?")}
        description={t(
          "Alloy will leave the current server and connect to {serverUrl}.",
          { serverUrl: serverToConnect ?? "" },
        )}
        confirmLabel={t("Switch server")}
        pendingLabel={t("Connecting...")}
        pending={
          serverToConnect !== null &&
          sameServerTarget(connectingServerUrl, serverToConnect)
        }
        onConfirm={() => {
          if (serverToConnect !== null) void connectTo(serverToConnect, true)
        }}
      />
      <ConfirmDeleteDialog
        open={serverToForget !== null}
        onOpenChange={(open) => {
          if (!open && !forgetting) {
            setServerToForget(null)
            setForgetError(null)
          }
        }}
        title={t("Forget this Alloy server?")}
        description={t(
          "Saved login data for {serverUrl} will be removed from this device.",
          { serverUrl: serverToForget ?? "" },
        )}
        confirmLabel={t("Forget server")}
        pendingLabel={t("Forgetting...")}
        pending={forgetting}
        error={forgetError}
        onConfirm={() => {
          if (serverToForget !== null) void forgetServer(serverToForget)
        }}
      />
    </div>
  )
}

function ServerConnectForm({
  url,
  busy,
  connectingServerUrl,
  setUrl,
  onSubmit,
}: {
  url: string
  busy: boolean
  connectingServerUrl: string | null
  setUrl: (value: string) => void
  onSubmit: (event: FormEvent) => Promise<void>
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label htmlFor="desktop-server-url" className="text-xs font-medium">
        {t("Server address")}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="desktop-server-url"
          type="text"
          inputMode="url"
          placeholder="alloy.example.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={busy}
          className="sm:flex-1"
        />
        <Button type="submit" disabled={busy || !url.trim()}>
          {busy && sameServerTarget(connectingServerUrl, url) ? (
            <>
              <Spinner />
              {t("Connecting...")}
            </>
          ) : (
            <>
              <PlusIcon className="size-4" />
              {t("Add server")}
            </>
          )}
        </Button>
      </div>
    </form>
  )
}

function SavedServerList({
  servers,
  currentServerUrl,
  connectingServerUrl,
  busy,
  connectTo,
  forgetServer,
}: {
  servers: DesktopSavedServer[]
  currentServerUrl: string | null
  connectingServerUrl: string | null
  busy: boolean
  connectTo: (serverUrl: string) => Promise<void>
  forgetServer: (serverUrl: string) => void
}) {
  if (servers.length === 0) {
    return (
      <p className="text-foreground-dim text-xs">
        {t("No saved servers yet.")}
      </p>
    )
  }

  return (
    <SettingRows>
      {servers.map((server) => (
        <SavedServerRow
          key={server.serverUrl}
          server={server}
          current={
            currentServerUrl !== null &&
            sameOrigin(server.serverUrl, currentServerUrl)
          }
          connecting={sameServerTarget(connectingServerUrl, server.serverUrl)}
          busy={busy}
          connectTo={connectTo}
          forgetServer={forgetServer}
        />
      ))}
    </SettingRows>
  )
}

function SavedServerRow({
  server,
  current,
  connecting,
  busy,
  connectTo,
  forgetServer,
}: {
  server: DesktopSavedServer
  current: boolean
  connecting: boolean
  busy: boolean
  connectTo: (serverUrl: string) => Promise<void>
  forgetServer: (serverUrl: string) => void
}) {
  const compatible = savedCompatibility(server)
  const compatibilityLabel = compatible
    ? t("Compatible when last checked")
    : t("Incompatible when last checked")

  return (
    <div className="not-last:border-border flex items-center gap-2 py-3 not-last:border-b first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">
            {server.serverUrl}
          </span>
          {current ? (
            <span
              role="img"
              aria-label={t("Connected")}
              title={t("Connected")}
              className="text-foreground-dim inline-flex shrink-0"
            >
              <LinkIcon aria-hidden="true" className="size-3.5" />
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs">
          <span className="text-foreground-dim min-w-0 break-words">
            {server.serverVersion
              ? t("Server version {version}", {
                  version: server.serverVersion,
                })
              : t("Server version unknown")}
          </span>
          <span
            role="img"
            aria-label={compatibilityLabel}
            title={compatibilityLabel}
            className={cn(
              "inline-flex shrink-0",
              compatible ? "text-success" : "text-destructive",
            )}
          >
            {compatible ? (
              <CheckCircle2Icon aria-hidden="true" className="size-3.5" />
            ) : (
              <CircleXIcon aria-hidden="true" className="size-3.5" />
            )}
          </span>
        </div>
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy || current}
        onClick={() => void connectTo(server.serverUrl)}
      >
        {connecting ? (
          <>
            <Spinner />
            {t("Connecting...")}
          </>
        ) : (
          <>
            <LogInIcon className="size-3.5" />
            {t("Switch")}
          </>
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("Forget {serverUrl}", {
          serverUrl: server.serverUrl,
        })}
        title={t("Forget server")}
        disabled={busy || current}
        onClick={() => forgetServer(server.serverUrl)}
        className={cn(!current && "hover:text-danger")}
      >
        <Trash2Icon className="size-3.5" />
      </Button>
    </div>
  )
}

function sameOrigin(serverUrl: string, origin: string): boolean {
  try {
    return new URL(serverUrl).origin === new URL(origin).origin
  } catch {
    return false
  }
}

function sameServerTarget(left: string | null, right: string): boolean {
  return left !== null && left.trim() === right.trim()
}

function savedCompatibility(server: DesktopSavedServer): boolean {
  return (
    server.httpContract === DESKTOP_HTTP_CONTRACT_1 &&
    server.bridgeContract === DESKTOP_BRIDGE_CONTRACT_1
  )
}
