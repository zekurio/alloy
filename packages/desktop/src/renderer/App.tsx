import { t } from "@alloy/i18n"
import { AlloyLogo } from "@alloy/ui/components/alloy-logo"
import { Button } from "@alloy/ui/components/button"
import { Input } from "@alloy/ui/components/input"
import { Toaster } from "@alloy/ui/components/sonner"
import { Spinner } from "@alloy/ui/components/spinner"
import { toast } from "@alloy/ui/lib/toast"
import type { FormEvent } from "react"
import { useEffect, useRef, useState } from "react"

type Phase = "idle" | "connecting"

const CONNECT_ERROR_TOAST_ID = "desktop-connect-error"

export function App() {
  return (
    <>
      <ConnectApp />
      <Toaster />
    </>
  )
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
