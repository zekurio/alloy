import type { DesktopSavedServer } from "@alloy/contracts/desktop-api"
import {
  DesktopTauriConnectResultSchema,
  DesktopTauriErrorSchema,
  DesktopTauriSavedServersSchema,
} from "@alloy/contracts/desktop-tauri"
import { initializeClientLocale, t } from "@alloy/i18n"
import { AlloyLogo } from "@alloy/ui/components/alloy-logo"
import { Button } from "@alloy/ui/components/button"
import { Input } from "@alloy/ui/components/input"
import { Spinner } from "@alloy/ui/components/spinner"
import { initTheme } from "@alloy/ui/lib/theme"
import { invoke } from "@tauri-apps/api/core"
import { StrictMode, useEffect, useRef, useState, type FormEvent } from "react"
import { createRoot } from "react-dom/client"

import "@alloy/ui/globals.css"

type ConnectionState = "idle" | "connecting" | "cancelling"

function connectionError(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message
  const parsed = DesktopTauriErrorSchema.safeParse(cause)
  return parsed.success ? t(parsed.data) : t("Could not reach server.")
}

function ConnectScreen() {
  const attempt = useRef(0)
  const [url, setUrl] = useState("")
  const [state, setState] = useState<ConnectionState>("idle")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [servers, setServers] = useState<DesktopSavedServer[]>([])
  const [forgetting, setForgetting] = useState(false)

  const pending = state !== "idle" || forgetting

  useEffect(() => {
    let disposed = false
    async function loadServers() {
      try {
        const saved = DesktopTauriSavedServersSchema.parse(
          await invoke<unknown>("saved_servers"),
        )
        if (disposed) return
        setServers(saved)
        setUrl((current) => current || saved[0]?.serverUrl || "")
      } catch (cause) {
        if (!disposed) setError(connectionError(cause))
      }
    }
    void loadServers()
    window.addEventListener("focus", loadServers)
    return () => {
      disposed = true
      window.removeEventListener("focus", loadServers)
    }
  }, [])

  async function forgetServer(serverUrl: string) {
    if (pending) return
    setForgetting(true)
    setError(null)
    try {
      const saved = DesktopTauriSavedServersSchema.parse(
        await invoke<unknown>("forget_server", { url: serverUrl }),
      )
      setServers(saved)
      setUrl((current) => (current === serverUrl ? "" : current))
      setNotice(t("Saved login data removed from this device."))
    } catch (cause) {
      setError(connectionError(cause))
    } finally {
      setForgetting(false)
    }
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const serverUrl = url.trim()
    if (!serverUrl) return

    setError(null)
    setNotice(null)
    setState("connecting")
    const currentAttempt = ++attempt.current

    try {
      const result = DesktopTauriConnectResultSchema.safeParse(
        await invoke<unknown>("connect_server", { url: serverUrl }),
      )
      if (currentAttempt !== attempt.current) return
      if (!result.success) {
        throw new Error(t("The server returned an invalid Alloy response."))
      }
      // The native host has opened the server window. Leave this screen ready
      // for the next server switch when the host shows it again.
      setState("idle")
      setUrl(result.data.serverUrl)
      setNotice(null)
    } catch (cause) {
      if (currentAttempt !== attempt.current) return
      setState("idle")
      setError(connectionError(cause))
    }
  }

  async function cancel() {
    if (state !== "connecting") return
    ++attempt.current
    setState("cancelling")
    try {
      await invoke("cancel_connect")
      setState("idle")
      setError(null)
      setNotice(t("Server switch cancelled."))
    } catch (cause) {
      setState("idle")
      setError(connectionError(cause))
    }
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

          {state === "connecting" ? (
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
            {state === "connecting"
              ? t("Connecting...")
              : state === "cancelling"
                ? t("Cancelling...")
                : t("Connect")}
          </Button>

          {state === "connecting" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mx-auto"
              onClick={() => void cancel()}
            >
              {t("Cancel")}
            </Button>
          ) : null}

          {servers.length > 0 ? (
            <div className="mt-4 space-y-1">
              <p className="text-foreground-muted text-xs font-medium">
                {t("Saved servers")}
              </p>
              {servers.map((server) => (
                <div
                  key={server.serverUrl}
                  className="flex min-w-0 items-center gap-2"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => setUrl(server.serverUrl)}
                    className="min-w-0 flex-1 justify-start"
                  >
                    <span className="truncate">{server.serverUrl}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    aria-label={t("Forget {serverUrl}", {
                      serverUrl: server.serverUrl,
                    })}
                    onClick={() => void forgetServer(server.serverUrl)}
                  >
                    {t("Forget")}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="min-h-5" aria-live="polite">
            {notice ? (
              <p className="text-foreground-muted text-sm">{notice}</p>
            ) : null}
            {error ? (
              <p role="alert" className="text-danger text-sm">
                {error}
              </p>
            ) : null}
          </div>
        </form>
      </div>
    </main>
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
