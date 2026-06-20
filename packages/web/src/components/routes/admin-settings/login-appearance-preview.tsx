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
import { Slider } from "@alloy/ui/components/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alloy/ui/components/tooltip"
import { cn } from "@alloy/ui/lib/utils"
import { EyeIcon, XIcon } from "lucide-react"
import * as React from "react"

import {
  mobileCloseIconClassName,
  mobileSurfaceCloseButtonClassName,
} from "@/components/app/mobile-close-button"
import { AuthPageFrame } from "@/components/auth/auth-page-frame"
import { LoginForm } from "@/components/routes/login/login-page-inner"
import { SignUpForm } from "@/components/routes/sign-up/sign-up-page-inner"

type AuthPreviewMode = "login" | "sign-up"

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

function sliderValue(value: number | readonly number[]): number {
  return typeof value === "number" ? value : (value[0] ?? 0)
}

function BackdropTreatmentControls({
  blurPx,
  darkenOpacity,
  disabled,
  onBlurPxChange,
  onDarkenOpacityChange,
}: {
  blurPx: number
  darkenOpacity: number
  disabled?: boolean
  onBlurPxChange: (value: number) => void
  onDarkenOpacityChange: (value: number) => void
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm font-medium">
          <span>{tx("Blur")}</span>
          <span className="text-foreground-muted text-xs">
            {blurPx}
            {tx("px")}
          </span>
        </div>
        <Slider
          value={[blurPx]}
          min={0}
          max={48}
          step={1}
          disabled={disabled}
          onValueChange={(value) => onBlurPxChange(sliderValue(value))}
        />
      </div>
      <div className="min-w-0 space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm font-medium">
          <span>{tx("Darkening")}</span>
          <span className="text-foreground-muted text-xs">
            {Math.round(darkenOpacity * 100)}
            {"%"}
          </span>
        </div>
        <Slider
          value={[darkenOpacity]}
          min={0}
          max={1}
          step={0.01}
          disabled={disabled}
          onValueChange={(value) => onDarkenOpacityChange(sliderValue(value))}
        />
      </div>
    </div>
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
  blurPx,
  darkenOpacity,
  controlsDisabled,
  onBlurPxChange,
  onDarkenOpacityChange,
}: {
  config: AdminRuntimeConfig
  splash: PublicLoginSplashConfig
  blurPx: number
  darkenOpacity: number
  controlsDisabled?: boolean
  onBlurPxChange: (value: number) => void
  onDarkenOpacityChange: (value: number) => void
}) {
  const [mode, setMode] = React.useState<AuthPreviewMode>("login")
  const [open, setOpen] = React.useState(false)

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
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <EyeIcon />
        {tx("Open preview")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          centered={false}
          disableZoom
          className="border-border/80 bg-background top-3 right-3 bottom-3 left-3 flex h-auto w-auto max-w-none translate-x-0 translate-y-0 flex-col rounded-xl p-0 shadow-2xl sm:top-5 sm:right-5 sm:bottom-5 sm:left-5"
        >
          <DialogTitle className="sr-only">
            {mode === "login"
              ? tx("Login page preview")
              : tx("Sign-up page preview")}
          </DialogTitle>

          <div className="border-border/70 bg-surface/88 relative z-10 flex flex-col gap-3 border-b px-4 py-3 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {tx("Login appearance")}
              </div>
              <div className="text-foreground-muted text-xs">
                {mode === "login"
                  ? tx("Login page preview")
                  : tx("Sign-up page preview")}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ModeToggle
                mode={mode}
                onChange={setMode}
                signUpDisabled={!canSignUp}
              />
              <DialogClose
                className={cn(
                  mobileSurfaceCloseButtonClassName,
                  "border border-border bg-surface-raised",
                )}
                aria-label={tx("Close preview")}
              >
                <XIcon className={mobileCloseIconClassName} />
              </DialogClose>
            </div>
          </div>

          {/* Non-interactive: the preview renders the real auth buttons, but
              clicks must not start an actual sign-in flow. */}
          <div className="min-h-0 flex-1 select-none">
            <div className="pointer-events-none h-full w-full">
              <AuthPreviewContent mode={mode} config={authConfig} fill />
            </div>
          </div>

          <div className="border-border/70 bg-surface/92 relative z-10 border-t px-4 py-4 backdrop-blur-sm sm:px-6">
            <BackdropTreatmentControls
              blurPx={blurPx}
              darkenOpacity={darkenOpacity}
              disabled={controlsDisabled}
              onBlurPxChange={onBlurPxChange}
              onDarkenOpacityChange={onDarkenOpacityChange}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
