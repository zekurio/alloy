import { t } from "@alloy/i18n"
import { AlloyLogo } from "@alloy/ui/components/alloy-logo"
import { Button } from "@alloy/ui/components/button"
import { Input } from "@alloy/ui/components/input"
import { Toaster } from "@alloy/ui/components/sonner"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import type { FormEvent } from "react"
import { useEffect, useRef, useState } from "react"

import type { StartupUpdateState } from "@/shared/ipc"

type Phase = "idle" | "connecting"

const CONNECT_ERROR_TOAST_ID = "desktop-connect-error"

export function App() {
  const [startupUpdate, setStartupUpdate] = useState<StartupUpdateState | null>(
    null,
  )

  useEffect(() => {
    const native = window.alloyNative
    if (!native) return
    void native
      .getStartupUpdate()
      .then(setStartupUpdate)
      .catch(() => {
        setStartupUpdate((current) => current ?? { phase: "inactive" })
      })
    return native.onStartupUpdate(setStartupUpdate)
  }, [])

  return (
    <>
      {startupUpdate === null ? (
        <StartupSurfaceLoading />
      ) : startupUpdate.phase !== "inactive" ? (
        <StartupUpdateApp state={startupUpdate} />
      ) : (
        <ConnectApp />
      )}
      <Toaster />
    </>
  )
}

function StartupSurfaceLoading() {
  return (
    <main className="bg-background text-foreground relative flex h-full w-full flex-col">
      <header className="absolute top-8 left-6 z-10 flex items-center sm:left-10">
        <AlloyLogo size={36} showText markSrc="./logo.png" />
      </header>
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-accent size-6" />
        <span className="sr-only">{t("Starting Alloy...")}</span>
      </div>
    </main>
  )
}

function StartupUpdateApp({ state }: { state: StartupUpdateState }) {
  if (state.phase === "inactive") return null
  const version = state.phase === "checking" ? null : state.version
  const title =
    state.phase === "checking"
      ? t("Checking for updates")
      : state.phase === "downloading"
        ? t("Downloading Alloy {version}", { version })
        : state.phase === "installing"
          ? t("Installing Alloy {version}", { version })
          : t("Alloy could not update")

  return (
    <main className="bg-background text-foreground relative flex h-full w-full flex-col">
      <header className="absolute top-8 left-6 z-10 flex items-center sm:left-10">
        <AlloyLogo size={36} showText markSrc="./logo.png" />
      </header>

      <div className="flex h-full w-full items-center justify-center px-6 py-24 sm:px-10">
        <section className="flex w-full max-w-sm flex-col items-center text-center">
          {state.phase === "error" ? (
            <div className="bg-destructive/10 text-destructive mb-5 flex size-14 items-center justify-center rounded-2xl">
              <span className="text-2xl font-semibold" aria-hidden="true">
                !
              </span>
            </div>
          ) : (
            <div className="bg-accent/12 text-accent mb-5 flex size-14 items-center justify-center rounded-2xl">
              {state.phase === "downloading" ? (
                <span className="text-2xl" aria-hidden="true">
                  ↓
                </span>
              ) : (
                <Spinner className="size-6" />
              )}
            </div>
          )}
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-foreground-muted mt-2 text-sm leading-6">
            {state.phase === "checking"
              ? t(
                  "This quick check keeps Alloy Desktop and your server in sync.",
                )
              : state.phase === "downloading"
                ? t(
                    "Keep Alloy open. It will restart when the update is ready.",
                  )
                : state.phase === "installing"
                  ? t(
                      "Alloy is closing capture services and will restart shortly.",
                    )
                  : state.message}
          </p>
          {state.phase === "error" ? (
            <StartupUpdateActions state={state} />
          ) : null}
        </section>
      </div>
    </main>
  )
}

function StartupUpdateActions({
  state,
}: {
  state: Extract<StartupUpdateState, { phase: "error" }>
}) {
  const [pending, setPending] = useState<"retry" | "continue" | null>(null)
  const [seconds, setSeconds] = useState(() =>
    secondsUntil(state.autoContinueAt),
  )

  useEffect(() => {
    setSeconds(secondsUntil(state.autoContinueAt))
    if (!state.autoContinueAt) return
    const timer = setInterval(
      () => setSeconds(secondsUntil(state.autoContinueAt)),
      250,
    )
    return () => clearInterval(timer)
  }, [state.autoContinueAt])

  function run(action: "retry" | "continue") {
    if (pending) return
    setPending(action)
    const request =
      action === "retry"
        ? window.alloyNative?.retryStartupUpdate()
        : window.alloyNative?.continueStartup()
    void request?.catch(() => setPending(null))
  }

  return (
    <div className="mt-7 flex w-full flex-col gap-2">
      <Button
        type="button"
        className="w-full justify-center"
        disabled={pending !== null}
        onClick={() => run("retry")}
      >
        {pending === "retry" ? <Spinner /> : null}
        {t("Try again")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="w-full justify-center"
        disabled={pending !== null}
        onClick={() => run("continue")}
      >
        {pending === "continue"
          ? t("Starting Alloy...")
          : seconds === null
            ? t("Continue without updating")
            : t("Continue without updating ({seconds})", { seconds })}
      </Button>
      <button
        type="button"
        className="text-foreground-muted hover:text-foreground mt-2 text-sm underline underline-offset-4"
        onClick={() => {
          void window.alloyNative?.openReleases().catch(() => undefined)
        }}
      >
        {t("Download the installer manually")}
      </button>
    </div>
  )
}

function secondsUntil(value: string | null): number | null {
  if (!value) return null
  return Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 1000))
}

function ConnectApp() {
  const [url, setUrl] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")
  const inputRef = useRef<HTMLInputElement>(null)

  // This screen is only used for first connect or fallback after an invalid
  // saved session. Focus here rather than via autoFocus for accessibility.
  useEffect(() => {
    inputRef.current?.focus()
    window.alloyNative?.getStartupServer().then((serverUrl) => {
      if (serverUrl) setUrl(serverUrl)
    })
  }, [])

  async function connectTo(targetUrl: string) {
    if (phase === "connecting") return
    const nextUrl = targetUrl.trim()
    if (!nextUrl) return

    setUrl(nextUrl)
    toast.dismiss(CONNECT_ERROR_TOAST_ID)
    setPhase("connecting")

    const result = await window.alloyNative?.connect(nextUrl)
    if (!result) {
      toast.error(t("Desktop bridge is unavailable."), {
        id: CONNECT_ERROR_TOAST_ID,
      })
      setPhase("idle")
      return
    }
    if (!result.ok) {
      toast.error(result.error, { id: CONNECT_ERROR_TOAST_ID })
      setPhase("idle")
      return
    }

    // On success the main process loads the app and closes this window, so
    // there's usually nothing visible left to do here.
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    await connectTo(url)
  }

  return (
    <main className="bg-background text-foreground relative flex h-full w-full flex-col">
      <header className="absolute top-8 left-6 z-10 flex items-center sm:left-10">
        <AlloyLogo size={36} showText markSrc="./logo.png" />
      </header>

      <div className="flex h-full w-full items-center justify-center px-6 py-24 sm:px-10">
        <form
          onSubmit={handleSubmit}
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
            ref={inputRef}
            type="text"
            inputMode="url"
            placeholder="alloy.example.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            disabled={phase === "connecting"}
            aria-label={t("Server URL")}
          />

          {phase === "connecting" ? (
            <p className="text-foreground-muted text-sm">
              {t(
                "A browser window may open to sign in. Return here once you're done.",
              )}
            </p>
          ) : null}

          <Button
            type="submit"
            className="mt-2 w-full justify-center"
            disabled={phase === "connecting" || !url.trim()}
          >
            {phase === "connecting" ? (
              <>
                <Spinner /> {t("Connecting...")}
              </>
            ) : (
              t("Connect")
            )}
          </Button>
        </form>
      </div>
    </main>
  )
}
