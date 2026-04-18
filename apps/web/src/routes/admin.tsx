import * as React from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { ArrowLeftIcon, Trash2Icon } from "lucide-react"

import { AlloyLogo } from "@workspace/ui/components/alloy-logo"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import { Switch } from "@workspace/ui/components/switch"

import {
  type AdminOAuthProvider,
  type AdminRuntimeConfig,
  deleteOAuthProvider,
  fetchRuntimeConfig,
  saveOAuthProvider,
  updateRuntimeConfig,
} from "../lib/admin-api"
import { requireAdmin } from "../lib/route-guards"

/**
 * Admin console. `beforeLoad` redirects non-admins as a UX shortcut; every
 * admin endpoint still re-verifies server-side.
 */
export const Route = createFileRoute("/admin")({
  beforeLoad: () => requireAdmin(),
  loader: async () => {
    const config = await fetchRuntimeConfig()
    return { config }
  },
  component: AdminPage,
})

function AdminPage() {
  const initial = Route.useLoaderData()
  const [config, setConfig] = React.useState<AdminRuntimeConfig>(initial.config)

  async function onToggleOpenRegistrations(nextEnabled: boolean) {
    const previous = config
    setConfig({ ...config, openRegistrations: nextEnabled })
    try {
      const next = await updateRuntimeConfig({ openRegistrations: nextEnabled })
      setConfig(next)
      toast.success(
        nextEnabled ? "Open registrations on" : "Registrations closed",
        {
          description: nextEnabled
            ? "OAuth will auto-create new user accounts."
            : "OAuth will only sign in existing users.",
        },
      )
    } catch (cause) {
      setConfig(previous)
      toast.error("Update failed", {
        description:
          cause instanceof Error
            ? cause.message
            : "Couldn't save the change. Please try again.",
      })
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-sm text-foreground-muted hover:text-foreground"
            >
              <ArrowLeftIcon className="size-4" /> Back
            </Link>
            <div className="h-4 w-px bg-border" />
            <Link to="/admin" className="inline-flex items-center gap-2">
              <AlloyLogo showText size={20} />
              <Badge variant="accent">Admin</Badge>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            Authentication
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Configure the OAuth provider and registration behaviour. All
            changes apply immediately — no restart required.
          </p>
        </div>

        <OAuthProviderCard
          provider={config.oauthProvider}
          onChange={(next) => setConfig(next)}
        />

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Open registrations</CardTitle>
              <CardDescription>
                When on, a successful OAuth sign-in for a new external
                identity creates an account automatically. When off, OAuth
                only lets existing users sign in.
              </CardDescription>
            </div>
            <Switch
              checked={config.openRegistrations}
              onCheckedChange={onToggleOpenRegistrations}
            />
          </CardHeader>
        </Card>
      </main>
    </div>
  )
}

/**
 * Editor for the single OAuth provider. Client-secret is never returned
 * from the server, so admins re-enter it on every save.
 */
function OAuthProviderCard({
  provider,
  onChange,
}: {
  provider: AdminOAuthProvider | null
  onChange: (next: AdminRuntimeConfig) => void
}) {
  const [form, setForm] = React.useState<AdminOAuthProvider>(
    provider ?? emptyProvider(),
  )
  const [pending, setPending] = React.useState<"save" | "delete" | null>(null)

  function set<K extends keyof AdminOAuthProvider>(
    key: K,
    value: AdminOAuthProvider[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    setPending("save")
    try {
      const next = await saveOAuthProvider({
        ...form,
        // Drop empty strings on optional URLs so the server's refine()
        // check treats them as absent.
        discoveryUrl: emptyToUndefined(form.discoveryUrl),
        authorizationUrl: emptyToUndefined(form.authorizationUrl),
        tokenUrl: emptyToUndefined(form.tokenUrl),
        userInfoUrl: emptyToUndefined(form.userInfoUrl),
      })
      onChange(next)
      toast.success("OAuth provider saved", {
        description: "Login page now offers the new provider.",
      })
    } catch (cause) {
      toast.error("Couldn't save the provider", {
        description:
          cause instanceof Error
            ? cause.message
            : "Please review the form and try again.",
      })
    } finally {
      setPending(null)
    }
  }

  async function onDelete() {
    if (pending || !provider) return
    setPending("delete")
    try {
      const next = await deleteOAuthProvider()
      onChange(next)
      setForm(emptyProvider())
      toast.success("OAuth provider removed", {
        description: "Only email/password login is available now.",
      })
    } catch (cause) {
      toast.error("Couldn't remove the provider", {
        description:
          cause instanceof Error
            ? cause.message
            : "Please try again.",
      })
    } finally {
      setPending(null)
    }
  }

  return (
    <form onSubmit={onSave}>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>OAuth provider</CardTitle>
            <CardDescription>
              One OIDC- or OAuth2-compatible identity provider. Provide a
              discovery URL when the provider supports it — we'll read the
              auth, token, and userinfo endpoints from there. For classic
              OAuth2 services without discovery, fill the three URLs below
              manually.
            </CardDescription>
          </div>
          {provider ? <Badge variant="accent">Configured</Badge> : null}
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="oauth-provider-id">Provider ID</FieldLabel>
              <Input
                id="oauth-provider-id"
                value={form.providerId}
                placeholder="sso"
                pattern="^[a-z0-9-]+$"
                title="lowercase letters, digits, dashes"
                required
                onChange={(e) => set("providerId", e.target.value)}
              />
              <p className="mt-1 text-xs text-foreground-faint">
                URL-safe slug used in the OAuth callback path. Changing this
                invalidates linked accounts.
              </p>
            </Field>

            <Field>
              <FieldLabel htmlFor="oauth-button-text">Button label</FieldLabel>
              <Input
                id="oauth-button-text"
                value={form.buttonText}
                placeholder="Log in with Company SSO"
                required
                maxLength={128}
                onChange={(e) => set("buttonText", e.target.value)}
              />
              <p className="mt-1 text-xs text-foreground-faint">
                Rendered verbatim on the login page's OAuth button.
              </p>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="oauth-client-id">Client ID</FieldLabel>
              <Input
                id="oauth-client-id"
                value={form.clientId}
                required
                onChange={(e) => set("clientId", e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="oauth-client-secret">
                Client secret
              </FieldLabel>
              <Input
                id="oauth-client-secret"
                type="password"
                autoComplete="new-password"
                value={form.clientSecret}
                required
                placeholder={
                  provider ? "Re-enter to save changes" : "Client secret"
                }
                onChange={(e) => set("clientSecret", e.target.value)}
              />
              <p className="mt-1 text-xs text-foreground-faint">
                Stored on disk in the runtime config. Never returned to the
                browser — re-enter every time you save.
              </p>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="oauth-discovery">Discovery URL</FieldLabel>
            <Input
              id="oauth-discovery"
              type="url"
              value={form.discoveryUrl ?? ""}
              placeholder="https://sso.example.com/realms/main/.well-known/openid-configuration"
              onChange={(e) => set("discoveryUrl", e.target.value)}
            />
            <p className="mt-1 text-xs text-foreground-faint">
              Preferred for OIDC providers. Leave blank and fill the three
              URLs below for providers without discovery (GitHub, Discord, …).
            </p>
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="oauth-auth-url">Authorization URL</FieldLabel>
              <Input
                id="oauth-auth-url"
                type="url"
                value={form.authorizationUrl ?? ""}
                onChange={(e) => set("authorizationUrl", e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="oauth-token-url">Token URL</FieldLabel>
              <Input
                id="oauth-token-url"
                type="url"
                value={form.tokenUrl ?? ""}
                onChange={(e) => set("tokenUrl", e.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="oauth-userinfo-url">Userinfo URL</FieldLabel>
              <Input
                id="oauth-userinfo-url"
                type="url"
                value={form.userInfoUrl ?? ""}
                onChange={(e) => set("userInfoUrl", e.target.value)}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="oauth-scopes">Scopes</FieldLabel>
            <Input
              id="oauth-scopes"
              value={(form.scopes ?? []).join(" ")}
              placeholder="openid profile email"
              onChange={(e) =>
                set(
                  "scopes",
                  e.target.value
                    .split(/\s+/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
            />
            <p className="mt-1 text-xs text-foreground-faint">
              Space-separated. OIDC usually wants{" "}
              <code className="rounded bg-surface-raised px-1 py-0.5">
                openid profile email
              </code>
              .
            </p>
          </Field>
        </CardContent>

        <CardFooter>
          {provider ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onDelete}
              disabled={pending !== null}
            >
              <Trash2Icon className="size-4" />
              {pending === "delete" ? "Removing…" : "Remove provider"}
            </Button>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={pending !== null}
          >
            {pending === "save"
              ? "Saving…"
              : provider
                ? "Save changes"
                : "Save provider"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

function emptyProvider(): AdminOAuthProvider {
  return {
    providerId: "",
    buttonText: "",
    clientId: "",
    clientSecret: "",
    scopes: [],
    discoveryUrl: "",
    authorizationUrl: "",
    tokenUrl: "",
    userInfoUrl: "",
    pkce: true,
  }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}
