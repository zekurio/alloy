import * as React from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeftIcon, Trash2Icon } from "lucide-react";

import {
  AppHeader,
  AppHeaderActions,
  AppHeaderBrand,
} from "@workspace/ui/components/app-header";
import { AppMain, AppShell } from "@workspace/ui/components/app-shell";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { toast } from "@workspace/ui/components/sonner";
import { Switch } from "@workspace/ui/components/switch";

import { AdminUsersCard } from "../components/admin-users-card";
import { UserMenu } from "../components/user-menu";
import {
  type AdminOAuthProvider,
  type AdminRuntimeConfig,
  deleteOAuthProvider,
  fetchRuntimeConfig,
  saveOAuthProvider,
  updateRuntimeConfig,
} from "../lib/admin-api";
import { requireAdmin } from "../lib/route-guards";

/**
 * Admin console. `beforeLoad` redirects non-admins as a UX shortcut; every
 * admin endpoint still re-verifies server-side.
 */
export const Route = createFileRoute("/admin")({
  // See the note in `/` — exposing the session on the context lets
  // `UserMenu` render the correct identity on first paint instead of
  // flashing the "user" fallback while `useSession` fetches.
  beforeLoad: async () => ({ session: await requireAdmin() }),
  loader: async () => {
    const config = await fetchRuntimeConfig();
    return { config };
  },
  component: AdminPage,
});

function AdminPage() {
  const initial = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const [config, setConfig] = React.useState<AdminRuntimeConfig>(
    initial.config,
  );

  async function onToggleOpenRegistrations(nextEnabled: boolean) {
    setConfig((prev) => ({ ...prev, openRegistrations: nextEnabled }));
    try {
      const next = await updateRuntimeConfig({
        openRegistrations: nextEnabled,
      });
      setConfig(next);
      toast.success(
        nextEnabled ? "Registrations open" : "Registrations closed",
      );
    } catch (cause) {
      setConfig((prev) => ({ ...prev, openRegistrations: !nextEnabled }));
      toast.error(
        cause instanceof Error ? cause.message : "Update failed",
      );
    }
  }

  async function onToggleEmailPassword(nextEnabled: boolean) {
    setConfig((prev) => ({ ...prev, emailPasswordEnabled: nextEnabled }));
    try {
      const next = await updateRuntimeConfig({
        emailPasswordEnabled: nextEnabled,
      });
      setConfig(next);
      toast.success(
        nextEnabled ? "Password login enabled" : "Password login disabled",
      );
    } catch (cause) {
      setConfig((prev) => ({ ...prev, emailPasswordEnabled: !nextEnabled }));
      toast.error(
        cause instanceof Error ? cause.message : "Update failed",
      );
    }
  }

  return (
    <AppShell>
      <AppHeader>
        <AppHeaderBrand />
        <AppHeaderActions>
          <UserMenu seedUser={session?.user} />
        </AppHeaderActions>
      </AppHeader>
      <AppMain>
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Link
              to="/"
              className="inline-flex w-fit items-center gap-1.5 text-sm text-foreground-muted hover:text-foreground"
            >
              <ArrowLeftIcon className="size-4" /> Back
            </Link>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              Authentication
            </h1>
          </div>

          <OAuthProviderCard
            provider={config.oauthProvider}
            onChange={(next) => setConfig(next)}
          />

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Email &amp; password login</CardTitle>
                <CardDescription>
                  Off = OAuth-only. Make sure a provider is linked first.
                </CardDescription>
              </div>
              <Switch
                checked={config.emailPasswordEnabled}
                onCheckedChange={onToggleEmailPassword}
                disabled={
                  // Mirrors the server-side guard: refuse to disable the only
                  // remaining sign-in surface.
                  config.emailPasswordEnabled && config.oauthProvider === null
                }
              />
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Open registrations</CardTitle>
                <CardDescription>
                  Auto-create accounts on OAuth sign-in.
                </CardDescription>
              </div>
              <Switch
                checked={config.openRegistrations}
                onCheckedChange={onToggleOpenRegistrations}
              />
            </CardHeader>
          </Card>

          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">
            Users
          </h2>
          <AdminUsersCard currentUserId={session?.user.id ?? ""} />
        </div>
      </AppMain>
    </AppShell>
  );
}

/**
 * Editor for the single OAuth provider. Client-secret is never returned
 * from the server, so admins re-enter it on every save.
 */
function OAuthProviderCard({
  provider,
  onChange,
}: {
  provider: AdminOAuthProvider | null;
  onChange: (next: AdminRuntimeConfig) => void;
}) {
  const [form, setForm] = React.useState<AdminOAuthProvider>(
    provider ?? emptyProvider(),
  );
  const [pending, setPending] = React.useState<"save" | "delete" | null>(null);

  function set<K extends keyof AdminOAuthProvider>(
    key: K,
    value: AdminOAuthProvider[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending("save");
    try {
      const next = await saveOAuthProvider({
        ...form,
        // Drop empty strings on optional URLs so the server's refine()
        // check treats them as absent.
        discoveryUrl: emptyToUndefined(form.discoveryUrl),
        authorizationUrl: emptyToUndefined(form.authorizationUrl),
        tokenUrl: emptyToUndefined(form.tokenUrl),
        userInfoUrl: emptyToUndefined(form.userInfoUrl),
      });
      onChange(next);
      toast.success("Provider saved");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't save provider",
      );
    } finally {
      setPending(null);
    }
  }

  async function onDelete() {
    if (pending || !provider) return;
    setPending("delete");
    try {
      const next = await deleteOAuthProvider();
      onChange(next);
      setForm(emptyProvider());
      toast.success("Provider removed");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't remove provider",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <form onSubmit={onSave}>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>OAuth provider</CardTitle>
            <CardDescription>
              One OIDC/OAuth2 provider. Use discovery or manual endpoints.
            </CardDescription>
          </div>
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
              <FieldDescription>
                URL-safe slug.
              </FieldDescription>
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
                required={!provider}
                placeholder={
                  provider ? "Leave blank to keep current" : "Client secret"
                }
                onChange={(e) => set("clientSecret", e.target.value)}
              />
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
            <FieldDescription>
              Preferred for OIDC; otherwise fill endpoints below.
            </FieldDescription>
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="oauth-auth-url">
                Authorization URL
              </FieldLabel>
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
            <FieldDescription>Space-separated.</FieldDescription>
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
  );
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
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
