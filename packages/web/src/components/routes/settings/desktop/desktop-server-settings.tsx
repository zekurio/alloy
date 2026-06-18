import { t as tx } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import { Input } from "@alloy/ui/components/input"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import { cn } from "@alloy/ui/lib/utils"
import { CheckCircle2Icon, LogInIcon, PlusIcon, Trash2Icon } from "lucide-react"
import * as React from "react"
import { flushSync } from "react-dom"

import { alloyDesktop, type DesktopSavedServer } from "./desktop-bridge"

type Phase = "idle" | "loading" | "connecting"

export function DesktopServerSettings() {
  const desktop = alloyDesktop()
  const serverApi = desktop?.servers
  const [servers, setServers] = React.useState<DesktopSavedServer[]>([])
  const [url, setUrl] = React.useState("")
  const [phase, setPhase] = React.useState<Phase>("loading")
  const [connectingServerUrl, setConnectingServerUrl] = React.useState<
    string | null
  >(null)
  const [currentServerUrl, setCurrentServerUrl] = React.useState<string | null>(
    null,
  )

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      if (!serverApi) return
      setPhase("loading")
      try {
        const [savedServers, currentServer] = await Promise.all([
          serverApi.getServers(),
          serverApi.getCurrentServer(),
        ])
        if (cancelled) return
        setServers(savedServers)
        setCurrentServerUrl(currentServer)
      } catch (cause) {
        if (!cancelled) {
          toast.error(errorText(cause, tx("Couldn't load servers.")))
        }
      } finally {
        if (!cancelled) setPhase("idle")
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [serverApi])

  if (!serverApi) return null
  const activeServerApi = serverApi

  async function connectTo(serverUrl: string) {
    const nextUrl = serverUrl.trim()
    if (!nextUrl || connectingServerUrl !== null) return

    flushSync(() => {
      setConnectingServerUrl(nextUrl)
      setPhase("connecting")
    })
    try {
      const result = await activeServerApi.connect(nextUrl)
      if (!result.ok) {
        toast.error(result.error)
        setConnectingServerUrl(null)
        setPhase("idle")
        return
      }

      setUrl("")
      setConnectingServerUrl(null)
      setPhase("idle")
    } catch (cause) {
      toast.error(errorText(cause, tx("Couldn't connect to server.")))
      setConnectingServerUrl(null)
      setPhase("idle")
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    await connectTo(url)
  }

  async function forgetServer(serverUrl: string) {
    if (phase === "connecting") return
    try {
      const nextServers = await activeServerApi.forgetServer(serverUrl)
      setServers(nextServers)
    } catch (cause) {
      toast.error(errorText(cause, tx("Couldn't forget server.")))
    }
  }

  const busy = connectingServerUrl !== null

  return (
    <div className="flex flex-col gap-4">
      <ServerConnectForm
        url={url}
        busy={busy}
        connectingServerUrl={connectingServerUrl}
        setUrl={setUrl}
        onSubmit={handleSubmit}
      />

      <SavedServerList
        phase={phase}
        servers={servers}
        currentServerUrl={currentServerUrl}
        connectingServerUrl={connectingServerUrl}
        busy={busy}
        connectTo={connectTo}
        forgetServer={forgetServer}
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
  setUrl: (url: string) => void
  onSubmit: (event: React.FormEvent) => void
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
      <Input
        type="text"
        inputMode="url"
        placeholder="alloy.example.com"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        disabled={busy}
        aria-label={tx("Server URL")}
        className="sm:flex-1"
      />
      <Button type="submit" disabled={busy || !url.trim()}>
        {busy && sameServerTarget(connectingServerUrl, url) ? (
          <>
            <Spinner />
            {tx("Connecting...")}
          </>
        ) : (
          <>
            <PlusIcon className="size-4" />
            {tx("Add server")}
          </>
        )}
      </Button>
    </form>
  )
}

function SavedServerList({
  phase,
  servers,
  currentServerUrl,
  connectingServerUrl,
  busy,
  connectTo,
  forgetServer,
}: {
  phase: Phase
  servers: DesktopSavedServer[]
  currentServerUrl: string | null
  connectingServerUrl: string | null
  busy: boolean
  connectTo: (serverUrl: string) => Promise<void>
  forgetServer: (serverUrl: string) => Promise<void>
}) {
  if (phase === "loading") {
    return (
      <div className="text-foreground-muted flex h-16 items-center justify-center gap-2 text-sm">
        <Spinner />
        {tx("Loading servers")}
      </div>
    )
  }

  if (servers.length === 0) {
    return (
      <p className="text-foreground-muted text-sm">
        {tx("No saved servers yet.")}
      </p>
    )
  }

  return (
    <div className="flex flex-col">
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
    </div>
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
  forgetServer: (serverUrl: string) => Promise<void>
}) {
  return (
    <div className="not-last:border-border flex min-h-14 items-center gap-2 py-2.5 not-last:border-b first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">
            {server.serverUrl}
          </span>
          {current ? (
            <span className="text-success inline-flex shrink-0 items-center gap-1 text-xs font-medium">
              <CheckCircle2Icon className="size-3.5" />
              {tx("Current")}
            </span>
          ) : null}
        </div>
        <div className="text-foreground-faint mt-0.5 text-xs">
          {tx("Last used")}
          {formatLastConnected(server.lastConnectedAt)}
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
            {tx("Connecting...")}
          </>
        ) : (
          <>
            <LogInIcon className="size-3.5" />
            {tx("Switch")}
          </>
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={tx("Forget {serverUrl}", {
          serverUrl: server.serverUrl,
        })}
        title={tx("Forget server")}
        disabled={busy || current}
        onClick={() => void forgetServer(server.serverUrl)}
        className={cn(!current && "hover:text-danger")}
      >
        <Trash2Icon className="size-3.5" />
      </Button>
    </div>
  )
}

function sameOrigin(serverUrl: string, origin: string): boolean {
  try {
    return new URL(serverUrl).origin === origin
  } catch {
    return false
  }
}

function sameServerTarget(left: string | null, right: string): boolean {
  return left !== null && left.trim() === right.trim()
}

function formatLastConnected(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return tx("recently")
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
