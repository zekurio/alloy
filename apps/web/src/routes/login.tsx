import * as React from "react";
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
} from "lucide-react";

import { AlloyLogo } from "@workspace/ui/components/alloy-logo";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Field,
  FieldLabel,
  FieldSeparator,
} from "@workspace/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import { toast } from "@workspace/ui/components/sonner";

import { LoginArtwork } from "../components/login-artwork";
import { OAuthButton } from "../components/oauth-button";
import { authClient } from "../lib/auth-client";
import { fetchAuthConfig } from "../lib/auth-config";
import { fetchPublicClips } from "../lib/public-clips";
import { redirectIfAuthed } from "../lib/route-guards";

/**
 * Sign-in page. Redirects to /setup on a fresh install (no users yet);
 * otherwise shows the email/password form plus the configured OAuth button.
 */
export const Route = createFileRoute("/login")({
  // Signed-in users have no business on the sign-in page — bounce them home
  // before the loader runs so we don't flash the form.
  beforeLoad: () => redirectIfAuthed("/"),
  loader: async () => {
    // `fetchPublicClips` is soft-failing, so this Promise.all can't reject
    // on its behalf.
    const [config, clips] = await Promise.all([
      fetchAuthConfig(),
      fetchPublicClips(),
    ]);
    if (config.setupRequired) {
      throw redirect({ to: "/setup" });
    }
    return { config, clips };
  },
  component: LoginPage,
});

function LoginPage() {
  const { config, clips } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [rememberMe, setRememberMe] = React.useState(true);
  const [pending, setPending] = React.useState(false);
  const [oauthPending, setOauthPending] = React.useState(false);

  const provider = config.provider;
  const emailPasswordEnabled = config.emailPasswordEnabled;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const { error: err } = await authClient.signIn.email({
        email,
        password,
        rememberMe,
      });
      if (err) {
        toast.error("Couldn't sign in", {
          description: err.message ?? "Check your email and password and try again.",
        });
        return;
      }
      await router.invalidate();
      await navigate({ to: "/" });
    } catch (cause) {
      toast.error("Unexpected sign-in error", {
        description:
          cause instanceof Error
            ? cause.message
            : "Something went wrong. Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  async function onOAuth() {
    if (oauthPending || !provider) return;
    setOauthPending(true);
    try {
      await authClient.signIn.oauth2({
        providerId: provider.providerId,
        // Absolute URL on the web origin — otherwise better-auth resolves
        // the callback relative to its own baseURL (the API server), and
        // successful OAuth lands the user on http://<api>/ instead of the
        // web app. The web origin must be in the server's `trustedOrigins`.
        callbackURL: `${window.location.origin}/`,
      });
      // The call redirects on success; this line only runs if something
      // short-circuited server-side.
    } catch (cause) {
      toast.error("OAuth sign-in failed", {
        description:
          cause instanceof Error
            ? cause.message
            : "We couldn't complete the redirect. Please try again.",
      });
      setOauthPending(false);
    }
  }

  return (
    <div className="relative grid min-h-screen w-full bg-background text-foreground lg:grid-cols-[1fr_minmax(480px,0.7fr)]">
      <div className="relative hidden overflow-hidden lg:block">
        <LoginArtwork clips={clips} />
      </div>

      <div className="relative flex min-h-screen flex-col px-6 py-8 sm:px-10">
        <header className="flex items-center">
          <Link to="/" className="inline-flex items-center">
            <AlloyLogo showText size={36} />
          </Link>
        </header>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            <div className="mb-8 space-y-1.5">
              <h2 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">
                Sign in
              </h2>
              <p className="text-sm text-foreground-muted">
                Welcome back — pick up where you left off.
              </p>
            </div>

            {emailPasswordEnabled ? (
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="login-email">Email</FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <MailIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={pending}
                  />
                </InputGroup>
              </Field>

              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="login-password">Password</FieldLabel>
                  <a
                    href="#"
                    className="text-xs text-foreground-muted underline-offset-4 hover:text-accent hover:underline"
                  >
                    Forgot?
                  </a>
                </div>
                <InputGroup>
                  <InputGroupAddon>
                    <LockIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={pending}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      onClick={() => setShowPassword((v) => !v)}
                      disabled={pending}
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </Field>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground-muted select-none">
                <Checkbox
                  checked={rememberMe}
                  onCheckedChange={(value) => setRememberMe(value === true)}
                  disabled={pending}
                />
                Keep me signed in
              </label>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="w-full"
                disabled={pending}
              >
                {pending ? "Signing in…" : "Sign in"}
                <ArrowRightIcon className="size-4" />
              </Button>
            </form>
            ) : null}

            {provider ? (
              <>
                {emailPasswordEnabled ? (
                  <div className="my-6">
                    <FieldSeparator>OR</FieldSeparator>
                  </div>
                ) : null}
                <OAuthButton
                  providerId={provider.providerId}
                  buttonText={provider.buttonText}
                  className="w-full"
                  disabled={oauthPending}
                  onClick={onOAuth}
                />
              </>
            ) : null}

            {!emailPasswordEnabled && !provider ? (
              <p className="mt-6 text-sm text-foreground-muted">
                Sign-in is currently unavailable. Ask an administrator to
                enable a login method.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
