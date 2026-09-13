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
import { Globe2Icon, LockKeyholeIcon } from "lucide-react"
import { StrictMode, useEffect, useRef, useState, type FormEvent } from "react"
import { createRoot } from "react-dom/client"

import "@alloy/ui/globals.css"

type ConnectionState = "idle" | "connecting" | "cancelling"

function connectionError(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message
  const parsed = DesktopTauriErrorSchema.safeParse(cause)
  return parsed.success ? parsed.data : t("Could not reach server.")
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
    <main className="bg-background text-foreground relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-10 sm:px-8">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,color-mix(in_oklab,var(--border)_36%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--border)_36%,transparent)_1px,transparent_1px)] [background-size:32px_32px] opacity-40"
      />
      <div
        aria-hidden="true"
        className="bg-accent/10 pointer-events-none absolute -top-32 left-1/2 size-96 -translate-x-1/2 rounded-full blur-3xl"
      />

      <section className="relative w-full max-w-[440px]">
        <header className="mb-7 flex items-center justify-between px-1">
          <AlloyLogo showText size={32} />
          <span className="text-foreground-faint font-mono text-[11px] tracking-[0.08em]">
            {t("DESKTOP")}
          </span>
        </header>

        <div className="border-border bg-surface/95 rounded-2xl border p-6 shadow-[0_24px_80px_color-mix(in_oklab,var(--background)_60%,transparent)] backdrop-blur sm:p-8">
          <div className="mb-7 space-y-2">
            <div className="bg-accent/12 text-accent inline-flex items-center gap-2 rounded-full px-2.5 py-1 font-mono text-[11px] font-medium tracking-[0.04em]">
              <span className="bg-accent size-1.5 rounded-full" />
              {t("Server connection")}
            </div>
            <h1 className="text-foreground text-2xl font-semibold tracking-[-0.025em] sm:text-[28px]">
              {t("Connect to Alloy")}
            </h1>
            <p className="text-foreground-muted max-w-[34ch] text-sm leading-6">
              {t(
                "Enter your server URL. If sign-in is needed, Alloy opens your browser.",
              )}
            </p>
          </div>

          <form onSubmit={connect} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="server-url"
                className="text-foreground text-sm font-medium"
              >
                {t("Server URL")}
              </label>
              <div className="relative">
                <Globe2Icon
                  aria-hidden="true"
                  className="text-foreground-faint pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
                />
                <Input
                  id="server-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://alloy.example.com"
                  autoComplete="url"
                  disabled={pending}
                  required
                  className="h-11 pl-10 font-mono text-sm"
                />
              </div>
              <p className="text-foreground-faint flex items-start gap-1.5 text-xs leading-5">
                <LockKeyholeIcon
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0"
                />
                {t("Use HTTPS. HTTP works for localhost only.")}
              </p>
            </div>

            <Button
              type="submit"
              size="lg"
              className="h-11 w-full"
              disabled={pending}
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
                className="mx-auto block"
                onClick={() => void cancel()}
              >
                {t("Cancel")}
              </Button>
            ) : null}
          </form>

          {servers.length > 0 ? (
            <div className="border-border mt-5 space-y-2 border-t pt-4">
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

          <div className="min-h-6 pt-4" aria-live="polite">
            {notice ? (
              <p className="text-foreground-muted text-sm">{notice}</p>
            ) : null}
            {error ? (
              <p role="alert" className="text-danger text-sm leading-5">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <p className="text-foreground-faint mt-5 text-center text-xs">
          {t("Your server keeps your clips and account data.")}
        </p>
      </section>
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
