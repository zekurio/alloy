import type { DesktopSavedServer } from "@alloy/contracts/desktop-api"
import {
  DesktopErrorMessageSchema,
  DesktopSavedServersSchema,
} from "@alloy/contracts/desktop-bridge"
import { initializeClientLocale, t } from "@alloy/i18n"
import { AlloyLogo } from "@alloy/ui/components/alloy-logo"
import { Button } from "@alloy/ui/components/button"
import { Input } from "@alloy/ui/components/input"
import { Toaster } from "@alloy/ui/components/sonner"
import { Spinner } from "@alloy/ui/components/spinner"
import { initTheme } from "@alloy/ui/lib/theme"
import { toast } from "@alloy/ui/lib/toast"
import {
  StrictMode,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react"
import { createRoot } from "react-dom/client"

import "@alloy/ui/globals.css"

import type { AlloyConnectApi } from "../shared/ipc"

declare global {
  interface Window {
    /** Installed by the connect window's preload (`src/preload/connect.ts`). */
    alloyConnect: AlloyConnectApi
  }
}

const host = window.alloyConnect

type ConnectionState = "idle" | "connecting" | "cancelling"

function connectionError(cause: unknown): string {
  const parsed = DesktopErrorMessageSchema.safeParse(
    cause instanceof Error ? cause.message : cause,
  )
  return parsed.success ? t(parsed.data) : t("Could not reach server.")
}

function ConnectScreen() {
  const [url, setUrl] = useState("")
  const [servers, setServers] = useState<DesktopSavedServer[]>([])
  const [forgetting, setForgetting] = useState(false)
  // Bumped when a forget lands, so a list read before it cannot replace it.
  const serversRevision = useRef(0)

  // Toasts replace themselves by id so repeated failures never stack.
  const showError = useCallback(
    (cause: unknown) =>
      toast.error(connectionError(cause), { id: "desktop-connect-error" }),
    [],
  )
  const connection = useConnectAttempt(showError)
  const pending = connection.state !== "idle" || forgetting

  useEffect(() => {
    let disposed = false
    async function loadServers() {
      const revision = serversRevision.current
      try {
        const saved = DesktopSavedServersSchema.parse(await host.savedServers())
        if (disposed || revision !== serversRevision.current) return
        setServers(saved)
        setUrl((current) => current || saved[0]?.serverUrl || "")
      } catch (cause) {
        if (!disposed) showError(cause)
      }
    }
    void loadServers()
    window.addEventListener("focus", loadServers)
    return () => {
      disposed = true
      window.removeEventListener("focus", loadServers)
    }
  }, [showError])

  // The host keeps this window hidden until the screen has painted, so the
  // first launch never flashes an empty window.
  useEffect(() => {
    host.connectReady().catch(() => {})
  }, [])

  async function forgetServer(serverUrl: string) {
    if (pending) return
    setForgetting(true)
    try {
      const saved = DesktopSavedServersSchema.parse(
        await host.forgetServer(serverUrl),
      )
      serversRevision.current++
      setServers(saved)
      setUrl((current) => (current === serverUrl ? "" : current))
      toast.success(t("Saved login data removed from this device."), {
        id: "desktop-connect-notice",
      })
    } catch (cause) {
      showError(cause)
    } finally {
      setForgetting(false)
    }
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const serverUrl = url.trim()
    if (!serverUrl) return

    // On success the host shows the server window and destroys this one.
    await connection.connect(serverUrl)
  }

  return (
    <main className="bg-background text-foreground relative flex h-dvh w-full flex-col">
      <header className="absolute top-8 left-6 z-10 flex items-center sm:left-10">
        <AlloyLogo size={36} showText />
      </header>

      <div className="flex h-full w-full items-center justify-center px-6 py-24 sm:px-10">
        <form
          onSubmit={connect}
          className="flex w-full max-w-sm flex-col gap-3 text-left"
        >
          <div className="mb-5 space-y-1.5">
            <h1 className="text-foreground text-2xl font-semibold">
              {t("Connect to Alloy")}
            </h1>
            <p className="text-foreground-muted text-sm">
              {t("Enter your server URL to authenticate the desktop app.")}
            </p>
          </div>

          <Input
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="alloy.example.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={pending}
            required
            aria-label={t("Server URL")}
          />

          {connection.state === "connecting" ? (
            <p className="text-foreground-muted text-sm">
              {t(
                "A browser window may open to sign in. Return here once you're done.",
              )}
            </p>
          ) : null}

          <Button
            type="submit"
            className="mt-2 w-full justify-center"
            disabled={pending || !url.trim()}
          >
            {pending ? <Spinner /> : null}
            {connection.state === "connecting"
              ? t("Connecting...")
              : connection.state === "cancelling"
                ? t("Cancelling...")
                : t("Connect")}
          </Button>

          {connection.state === "connecting" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mx-auto"
              onClick={() => void connection.cancel()}
            >
              {t("Cancel")}
            </Button>
          ) : null}

          <SavedServerList
            servers={servers}
            disabled={pending}
            onSelect={setUrl}
            onForget={(serverUrl) => void forgetServer(serverUrl)}
          />
        </form>
      </div>
      <Toaster />
    </main>
  )
}

/**
 * One server switch at a time. Cancelling, or starting a newer attempt, makes
 * an older attempt's result fall on the floor instead of flipping the screen.
 */
function useConnectAttempt(showError: (cause: unknown) => void) {
  const attempt = useRef(0)
  const [state, setState] = useState<ConnectionState>("idle")

  async function connect(serverUrl: string) {
    setState("connecting")
    const currentAttempt = ++attempt.current

    try {
      await host.connectServer(serverUrl)
      if (currentAttempt === attempt.current) setState("idle")
    } catch (cause) {
      if (currentAttempt !== attempt.current) return
      setState("idle")
      showError(cause)
    }
  }

  async function cancel() {
    if (state !== "connecting") return
    ++attempt.current
    setState("cancelling")
    try {
      // Resolves once the host has stopped the attempt, so the next connect
      // does not find one still in progress.
      await host.cancelConnect()
      setState("idle")
      toast.info(t("Server switch cancelled."), {
        id: "desktop-connect-notice",
      })
    } catch (cause) {
      setState("idle")
      showError(cause)
    }
  }

  return { state, connect, cancel }
}

function SavedServerList({
  servers,
  disabled,
  onSelect,
  onForget,
}: {
  servers: DesktopSavedServer[]
  disabled: boolean
  onSelect: (serverUrl: string) => void
  onForget: (serverUrl: string) => void
}) {
  if (servers.length === 0) return null
  return (
    <div className="mt-4 space-y-1">
      <p className="text-foreground-muted text-xs font-medium">
        {t("Saved servers")}
      </p>
      {servers.map((server) => (
        <div key={server.serverUrl} className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onSelect(server.serverUrl)}
            className="min-w-0 flex-1 justify-start"
          >
            <span className="truncate">{server.serverUrl}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={t("Forget {serverUrl}", {
              serverUrl: server.serverUrl,
            })}
            onClick={() => onForget(server.serverUrl)}
          >
            {t("Forget")}
          </Button>
        </div>
      ))}
    </div>
  )
}

const root = document.getElementById("root")

if (!root) throw new Error("Missing root element")

initializeClientLocale()
initTheme()

createRoot(root).render(
  <StrictMode>
    <ConnectScreen />
  </StrictMode>,
)
