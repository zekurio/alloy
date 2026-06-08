import { Alert, AlertDescription } from "alloy-ui/components/alert"
import { Button } from "alloy-ui/components/button"
import { Input } from "alloy-ui/components/input"
import { Spinner } from "alloy-ui/components/spinner"
import { cn } from "alloy-ui/lib/utils"
import { CheckCircle2Icon, LogInIcon, PlusIcon, Trash2Icon } from "lucide-react"
import * as React from "react"

import { alloyDesktop, type DesktopSavedServer } from "./desktop-bridge"

type Phase = "idle" | "loading" | "connecting"

export function DesktopServerSettings() {
  const desktop = alloyDesktop()
  const serverApi = desktop?.servers
  const [servers, setServers] = React.useState<DesktopSavedServer[]>([])
  const [url, setUrl] = React.useState("")
  const [phase, setPhase] = React.useState<Phase>("loading")
  const [error, setError] = React.useState<string | null>(null)
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
        setError(null)
      } catch (cause) {
        if (!cancelled) setError(errorText(cause, "Couldn't load servers."))
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
    if (!nextUrl || phase === "connecting") return

    setError(null)
    setPhase("connecting")
    try {
      const result = await activeServerApi.connect(nextUrl)
      if (!result.ok) {
        setError(result.error)
        setPhase("idle")
        return
      }

      const [savedServers, currentServer] = await Promise.all([
        activeServerApi.getServers(),
        activeServerApi.getCurrentServer(),
      ])
      setServers(savedServers)
      setCurrentServerUrl(currentServer ?? result.serverUrl)
      setUrl("")
      setPhase("idle")
    } catch (cause) {
      setError(errorText(cause, "Couldn't connect to server."))
      setPhase("idle")
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    await connectTo(url)
  }

  async function forgetServer(serverUrl: string) {
    if (phase === "connecting") return
    setError(null)
    try {
      const nextServers = await activeServerApi.forgetServer(serverUrl)
      setServers(nextServers)
    } catch (cause) {
      setError(errorText(cause, "Couldn't forget server."))
    }
  }

  const busy = phase === "connecting"

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="text"
          inputMode="url"
          placeholder="alloy.example.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={busy}
          aria-label="Server URL"
          className="sm:flex-1"
        />
        <Button type="submit" disabled={busy || !url.trim()}>
          {busy ? <Spinner /> : <PlusIcon className="size-4" />}
          Add server
        </Button>
      </form>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        {phase === "loading" ? (
          <div className="text-foreground-muted flex h-16 items-center justify-center gap-2 text-sm">
            <Spinner />
            Loading servers
          </div>
        ) : servers.length > 0 ? (
          servers.map((server) => {
            const current =
              currentServerUrl !== null &&
              sameOrigin(server.serverUrl, currentServerUrl)
            return (
              <div
                key={server.serverUrl}
                className="border-border bg-background flex min-h-14 items-center gap-2 rounded-md border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {server.serverUrl}
                    </span>
                    {current ? (
                      <span className="text-success inline-flex shrink-0 items-center gap-1 text-xs font-medium">
                        <CheckCircle2Icon className="size-3.5" />
                        Current
                      </span>
                    ) : null}
                  </div>
                  <div className="text-foreground-faint mt-0.5 text-xs">
                    Last used {formatLastConnected(server.lastConnectedAt)}
                  </div>
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy || current}
                  onClick={() => void connectTo(server.serverUrl)}
                >
                  <LogInIcon className="size-3.5" />
                  Switch
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Forget ${server.serverUrl}`}
                  title="Forget server"
                  disabled={busy || current}
                  onClick={() => void forgetServer(server.serverUrl)}
                  className={cn(!current && "hover:text-danger")}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            )
          })
        ) : (
          <p className="text-foreground-muted text-sm">No saved servers yet.</p>
        )}
      </div>
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

function formatLastConnected(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "recently"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback
}
