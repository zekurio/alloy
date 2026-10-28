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
import { useForm } from "@tanstack/react-form"
import { useMutation } from "@tanstack/react-query"
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
import { useState } from "react"
import { flushSync } from "react-dom"

import {
  SettingsSections,
  SettingsSubsection,
} from "@/components/routes/settings/settings-panel"
import { alloyDesktop, type DesktopSavedServer } from "@/lib/desktop"
import { errorMessage } from "@/lib/error-message"
import { useDesktopQuery } from "@/lib/use-desktop-query"

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
      <SettingsSubsection id="diagnostics" title={t("Diagnostics")}>
        <SettingRows>
          <DesktopLogSettings />
        </SettingRows>
      </SettingsSubsection>
    </SettingsSections>
  )
}

/** The host's saved servers and the current one, re-read on demand. */
function useSavedServers(serverApi: ServerApi | undefined) {
  const { data, setData, loading, loaded, error, refetch } = useDesktopQuery(
    ["servers"],
    serverApi ? () => loadSavedServers(serverApi) : null,
  )

  return {
    servers: data?.servers ?? [],
    setServers: (servers: DesktopSavedServer[]) =>
      setData((current) => ({
        servers,
        currentServerUrl: current?.currentServerUrl ?? null,
      })),
    currentServerUrl: data?.currentServerUrl ?? null,
    loading,
    loaded,
    // A reload clears the last failure until it settles.
    loadError:
      error && !loading
        ? errorMessage(error, t("Couldn't load servers."))
        : null,
    reload: refetch,
  }
}

async function loadSavedServers(api: ServerApi): Promise<{
  servers: DesktopSavedServer[]
  currentServerUrl: string | null
}> {
  const [servers, currentServerUrl] = await Promise.all([
    api.list(),
    api.current(),
  ])
  return { servers, currentServerUrl }
}

/**
 * A connect is held in state set through `flushSync`, not a mutation, so the
 * spinner commits before the host swaps this window for the new server's.
 */
type ConnectState =
  | { phase: "idle" }
  | { phase: "connecting"; serverUrl: string }
  | { phase: "failed"; message: string }

/** The confirm dialog that is open, and the server it is about. */
type ServerDialog = { kind: "connect" | "forget"; serverUrl: string } | null

function useServerUrlForm(connect: (serverUrl: string) => Promise<void>) {
  return useForm({
    defaultValues: { url: "" },
    onSubmit: ({ value }) => connect(value.url),
  })
}

type ServerUrlForm = ReturnType<typeof useServerUrlForm>

function ServerSettings({
  serverApi,
  saved,
}: {
  serverApi: ServerApi
  saved: SavedServers
}) {
  const { servers, setServers, currentServerUrl, loading, loadError, reload } =
    saved
  const [connect, setConnect] = useState<ConnectState>({ phase: "idle" })
  const [dialog, setDialog] = useState<ServerDialog>(null)
  const form = useServerUrlForm((serverUrl) => connectTo(serverUrl))
  const forget = useMutation({
    mutationFn: (serverUrl: string) => serverApi.forget(serverUrl),
    networkMode: "always",
    onSuccess: (next) => {
      setServers(next)
      setDialog(null)
    },
  })
  const connectingServerUrl =
    connect.phase === "connecting" ? connect.serverUrl : null
  const busy = connectingServerUrl !== null
  const serverToConnect = dialog?.kind === "connect" ? dialog.serverUrl : null
  const serverToForget = dialog?.kind === "forget" ? dialog.serverUrl : null

  async function connectTo(serverUrl: string, confirmed = false) {
    const nextUrl = serverUrl.trim()
    if (!nextUrl || busy) return
    if (
      !confirmed &&
      currentServerUrl !== null &&
      !sameOrigin(nextUrl, currentServerUrl)
    ) {
      setDialog({ kind: "connect", serverUrl: nextUrl })
      return
    }
    setDialog(null)

    flushSync(() => setConnect({ phase: "connecting", serverUrl: nextUrl }))
    try {
      // On success the host replaces this window with the new server's
      // window, so there is nothing left to update here.
      await serverApi.switchTo(nextUrl)
      form.reset()
      setConnect({ phase: "idle" })
    } catch (cause) {
      setConnect({
        phase: "failed",
        message: errorMessage(cause, t("Couldn't connect to server.")),
      })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {connect.phase === "failed" ? (
        <Callout tone="destructive" className="text-xs">
          <CircleAlertIcon />
          <span>{connect.message}</span>
        </Callout>
      ) : null}
      <ServerConnectForm
        form={form}
        busy={busy}
        connectingServerUrl={connectingServerUrl}
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
              forget.reset()
              setDialog({ kind: "forget", serverUrl })
            }}
          />
        )}
      </div>
      <ConfirmActionDialog
        open={serverToConnect !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
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
          if (!open && !forget.isPending) {
            setDialog(null)
            forget.reset()
          }
        }}
        title={t("Forget this Alloy server?")}
        description={t(
          "Saved login data for {serverUrl} will be removed from this device.",
          { serverUrl: serverToForget ?? "" },
        )}
        confirmLabel={t("Forget server")}
        pendingLabel={t("Forgetting...")}
        pending={forget.isPending}
        error={
          forget.error
            ? errorMessage(forget.error, t("Couldn't forget server."))
            : null
        }
        onConfirm={() => {
          if (serverToForget !== null && !busy && !forget.isPending) {
            forget.mutate(serverToForget)
          }
        }}
      />
    </div>
  )
}

function ServerConnectForm({
  form,
  busy,
  connectingServerUrl,
}: {
  form: ServerUrlForm
  busy: boolean
  connectingServerUrl: string | null
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
      className="flex flex-col gap-2"
    >
      <label htmlFor="desktop-server-url" className="text-xs font-medium">
        {t("Server address")}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <form.Field name="url">
          {(field) => (
            <Input
              id="desktop-server-url"
              type="text"
              inputMode="url"
              placeholder="alloy.example.com"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              disabled={busy}
              className="sm:flex-1"
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.url}>
          {(url) => (
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
          )}
        </form.Subscribe>
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
            {t("Server version {version}", {
              version: server.serverVersion,
            })}
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
