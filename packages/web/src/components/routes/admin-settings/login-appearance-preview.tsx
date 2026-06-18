import type {
  AdminRuntimeConfig,
  PublicAuthConfig,
  PublicLoginSplashConfig,
} from "@alloy/api"
import { DESKTOP_AUTH_CAPABILITY_VERSION } from "@alloy/contracts"
import { t as tx } from "@alloy/i18n"
import { Button } from "@alloy/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@alloy/ui/components/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alloy/ui/components/tooltip"
import { cn } from "@alloy/ui/lib/utils"
import { MaximizeIcon, XIcon } from "lucide-react"
import * as React from "react"

import { AuthPageFrame } from "@/components/auth/auth-page-frame"
import { LoginForm } from "@/components/routes/login/login-page-inner"
import { SignUpForm } from "@/components/routes/sign-up/sign-up-page-inner"

type AuthPreviewMode = "login" | "sign-up"

// 16:9 reference viewport the scaled in-card preview is laid out against.
const PREVIEW_WIDTH = 1280
const PREVIEW_HEIGHT = 720

/**
 * Build the public auth config the login/sign-up pages consume from the admin
 * runtime config, so the preview renders the exact same buttons users see.
 */
function toPublicAuthConfig(
  config: AdminRuntimeConfig,
  loginSplash: PublicLoginSplashConfig,
): PublicAuthConfig {
  return {
    adminAccountRequired: false,
    setupRequired: false,
    openRegistrations: config.openRegistrations,
    passkeyEnabled: config.passkeyEnabled,
    requireAuthToBrowse: config.requireAuthToBrowse,
    desktopAuth: { version: DESKTOP_AUTH_CAPABILITY_VERSION },
    providers: config.oauthProviders
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        buttonColor: provider.buttonColor,
        buttonTextColor: provider.buttonTextColor,
        iconUrl: provider.iconUrl,
      })),
    loginSplash,
  }
}

/** Renders children at a fixed reference size, scaled to fit the parent. */
function ScaledViewport({
  width,
  height,
  children,
}: {
  width: number
  height: number
  children: React.ReactNode
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [scale, setScale] = React.useState(0)

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () =>
      setScale(Math.min(el.clientWidth / width, el.clientHeight / height))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [height, width])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
    >
      {scale > 0 ? (
        <div
          style={{
            width,
            height,
            transform: `scale(${scale})`,
            transformOrigin: "center",
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

function AuthPreviewContent({
  mode,
  config,
  fill,
}: {
  mode: AuthPreviewMode
  config: PublicAuthConfig
  fill?: boolean
}) {
  return (
    <AuthPageFrame
      splash={config.loginSplash}
      fill={fill}
      desktopChrome={false}
    >
      {mode === "login" ? (
        <LoginForm config={config} passkeySupported />
      ) : (
        <SignUpForm config={config} passkeySupported />
      )}
    </AuthPageFrame>
  )
}

function modeButtonClass(active: boolean, disabled?: boolean): string {
  return cn(
    "rounded-[5px] px-3 py-1 text-xs font-medium transition-colors",
    active ? "bg-surface-raised text-foreground" : "text-foreground-muted",
    disabled ? "cursor-not-allowed opacity-50" : "hover:text-foreground",
  )
}

function ModeToggle({
  mode,
  onChange,
  signUpDisabled,
}: {
  mode: AuthPreviewMode
  onChange: (mode: AuthPreviewMode) => void
  signUpDisabled?: boolean
}) {
  return (
    <div className="border-border inline-flex rounded-md border p-0.5">
      <button
        type="button"
        aria-pressed={mode === "login"}
        onClick={() => onChange("login")}
        className={modeButtonClass(mode === "login")}
      >
        {tx("Login")}
      </button>
      {signUpDisabled ? (
        <Tooltip>
          {/* aria-disabled rather than the disabled attribute so the control
                still emits hover events and can show the tooltip. */}
          <TooltipTrigger
            aria-disabled
            aria-pressed={mode === "sign-up"}
            className={modeButtonClass(mode === "sign-up", true)}
          >
            {tx("Sign up")}
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {tx("Sign-ups are disabled")}
          </TooltipContent>
        </Tooltip>
      ) : (
        <button
          type="button"
          aria-pressed={mode === "sign-up"}
          onClick={() => onChange("sign-up")}
          className={modeButtonClass(mode === "sign-up")}
        >
          {tx("Sign up")}
        </button>
      )}
    </div>
  )
}

export function LoginAppearancePreview({
  config,
  splash,
}: {
  config: AdminRuntimeConfig
  splash: PublicLoginSplashConfig
}) {
  const [mode, setMode] = React.useState<AuthPreviewMode>("login")
  const [fullscreen, setFullscreen] = React.useState(false)

  const authConfig = React.useMemo(
    () => toPublicAuthConfig(config, splash),
    [config, splash],
  )

  // Mirror the real sign-up page guard: with no sign-up methods the form would
  // render empty, so disable the sign-up preview entirely.
  const canSignUp =
    authConfig.openRegistrations &&
    (authConfig.passkeyEnabled || authConfig.providers.length > 0)

  React.useEffect(() => {
    if (!canSignUp && mode === "sign-up") setMode("login")
  }, [canSignUp, mode])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <ModeToggle
          mode={mode}
          onChange={setMode}
          signUpDisabled={!canSignUp}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setFullscreen(true)}
        >
          <MaximizeIcon />
          {tx("Fullscreen")}
        </Button>
      </div>

      <div className="border-border bg-background relative aspect-video overflow-hidden rounded-md border">
        <ScaledViewport width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT}>
          {/* Non-interactive: the preview renders the real auth buttons, but
              clicks must not start an actual sign-in flow. */}
          <div className="pointer-events-none h-full w-full select-none">
            <AuthPreviewContent mode={mode} config={authConfig} fill />
          </div>
        </ScaledViewport>
      </div>

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent
          centered={false}
          disableZoom
          className="inset-0 top-0 left-0 h-screen w-screen max-w-none translate-x-0 translate-y-0 rounded-none border-0 p-0"
        >
          <DialogTitle className="sr-only">
            {mode === "login"
              ? tx("Login page preview")
              : tx("Sign-up page preview")}
          </DialogTitle>
          <div className="pointer-events-none h-full w-full select-none">
            <AuthPreviewContent mode={mode} config={authConfig} fill />
          </div>
          <DialogClose
            className="bg-background/72 text-foreground hover:bg-surface-raised absolute top-4 right-4 z-10 inline-flex size-9 items-center justify-center rounded-md border border-white/10 shadow-sm backdrop-blur-sm transition-colors"
            aria-label={tx("Close preview")}
          >
            <XIcon className="size-4" />
          </DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  )
}
