import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircleIcon, Trash2Icon } from "lucide-react";

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
import { NativeSelect } from "@workspace/ui/components/native-select";
import { toast } from "@workspace/ui/components/sonner";
import { Switch } from "@workspace/ui/components/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";

import { AdminUsersCard } from "../components/admin-users-card";
import {
  type AdminEncoderCapabilities,
  type AdminEncoderConfig,
  type AdminLimitsConfig,
  type AdminOAuthProvider,
  type AdminRuntimeConfig,
  ENCODER_CODECS,
  ENCODER_HWACCELS,
  ENCODER_TARGET_HEIGHTS,
  USERNAME_CLAIM_SUGGESTIONS,
  deleteOAuthProvider,
  fetchEncoderCapabilities,
  fetchRuntimeConfig,
  saveOAuthProvider,
  updateEncoderConfig,
  updateLimitsConfig,
  updateRuntimeConfig,
  type EncoderCodec,
  type EncoderHwaccel,
  type EncoderTargetHeight,
} from "../lib/admin-api";
import { useRequireAdmin } from "../lib/auth-hooks";

/**
 * Admin console. The `useRequireAdmin` hook redirects non-admins as a UX
 * shortcut; every admin endpoint still re-verifies server-side.
 *
 * Chrome (AppShell, sidebar, slim header, back-link, page wrapper) is
 * provided by `_app` + `_app/_settings` — switching to/from `/user-settings`
 * keeps all of that mounted.
 */
export const Route = createFileRoute("/_app/_settings/admin-settings")({
  component: AdminPage,
});

function AdminPage() {
  const session = useRequireAdmin();
  const [config, setConfig] = React.useState<AdminRuntimeConfig | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // Only fetch admin-only runtime config once we know the viewer is an
  // admin; non-admins are mid-redirect and we shouldn't touch the API.
  React.useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchRuntimeConfig()
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLoadError(
          cause instanceof Error ? cause.message : "Couldn't load settings",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!session) return null;
  if (loadError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {loadError}
      </div>
    );
  }
  if (!config) return null;

  async function onToggleOpenRegistrations(nextEnabled: boolean) {
    setConfig((prev) =>
      prev ? { ...prev, openRegistrations: nextEnabled } : prev,
    );
    try {
      const next = await updateRuntimeConfig({
        openRegistrations: nextEnabled,
      });
      setConfig(next);
      toast.success(
        nextEnabled ? "Registrations open" : "Registrations closed",
      );
    } catch (cause) {
      setConfig((prev) =>
        prev ? { ...prev, openRegistrations: !nextEnabled } : prev,
      );
      toast.error(cause instanceof Error ? cause.message : "Update failed");
    }
  }

  async function onToggleEmailPassword(nextEnabled: boolean) {
    setConfig((prev) =>
      prev ? { ...prev, emailPasswordEnabled: nextEnabled } : prev,
    );
    try {
      const next = await updateRuntimeConfig({
        emailPasswordEnabled: nextEnabled,
      });
      setConfig(next);
      toast.success(
        nextEnabled ? "Password login enabled" : "Password login disabled",
      );
    } catch (cause) {
      setConfig((prev) =>
        prev ? { ...prev, emailPasswordEnabled: !nextEnabled } : prev,
      );
      toast.error(cause instanceof Error ? cause.message : "Update failed");
    }
  }

  return (
    <Tabs defaultValue="auth">
      <TabsList className="mb-6">
        <TabsTrigger value="auth">Authentication</TabsTrigger>
        <TabsTrigger value="uploads">Uploads &amp; encoding</TabsTrigger>
        <TabsTrigger value="users">Users</TabsTrigger>
      </TabsList>

      <TabsContent value="auth" className="flex flex-col gap-4">
        <OAuthProviderCard
          provider={config.oauthProvider}
          onChange={(next) => setConfig(next)}
        />

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Email &amp; password login</CardTitle>
              <CardDescription>
                Disable login with email and password. Make sure an OAuth
                provider is set up first.
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
      </TabsContent>

      <TabsContent value="uploads" className="flex flex-col gap-4">
        <EncoderConfigCard
          encoder={config.encoder}
          onChange={(next) => setConfig(next)}
        />

        <LimitsConfigCard
          limits={config.limits}
          onChange={(next) => setConfig(next)}
        />
      </TabsContent>

      <TabsContent value="users">
        <AdminUsersCard currentUserId={session.user.id} />
      </TabsContent>
    </Tabs>
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
              <FieldDescription>URL-safe slug.</FieldDescription>
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

          {/*
           * The three endpoints below are only required when there's no
           * discovery URL — OIDC discovery populates the same metadata.
           * Mirrors the server-side refine() in config-store.ts.
           */}
          {(() => {
            const manualEndpointsRequired = !emptyToUndefined(
              form.discoveryUrl,
            );
            return (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="oauth-auth-url">
                    Authorization URL
                  </FieldLabel>
                  <Input
                    id="oauth-auth-url"
                    type="url"
                    value={form.authorizationUrl ?? ""}
                    required={manualEndpointsRequired}
                    onChange={(e) => set("authorizationUrl", e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="oauth-token-url">Token URL</FieldLabel>
                  <Input
                    id="oauth-token-url"
                    type="url"
                    value={form.tokenUrl ?? ""}
                    required={manualEndpointsRequired}
                    onChange={(e) => set("tokenUrl", e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="oauth-userinfo-url">
                    Userinfo URL
                  </FieldLabel>
                  <Input
                    id="oauth-userinfo-url"
                    type="url"
                    value={form.userInfoUrl ?? ""}
                    required={manualEndpointsRequired}
                    onChange={(e) => set("userInfoUrl", e.target.value)}
                  />
                </Field>
              </div>
            );
          })()}

          <div className="grid gap-4 sm:grid-cols-2">
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
            </Field>

            <Field>
              <FieldLabel htmlFor="oauth-username-claim">
                Username claim
              </FieldLabel>
              <Input
                id="oauth-username-claim"
                list="oauth-username-claim-suggestions"
                value={form.usernameClaim ?? ""}
                placeholder="preferred_username"
                onChange={(e) => set("usernameClaim", e.target.value)}
              />
              <datalist id="oauth-username-claim-suggestions">
                {USERNAME_CLAIM_SUGGESTIONS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <FieldDescription>
                Any claim on the OIDC userinfo response. Suggestions cover the
                common cases; type anything your provider emits.
              </FieldDescription>
            </Field>
          </div>
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
    usernameClaim: "preferred_username",
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Per-hwaccel UI hints. The server accepts any preset string — these are
 * autocomplete suggestions, plus a human label for the quality knob (the
 * underlying ffmpeg flag differs per backend: CRF / CQ / global_quality /
 * qp). Mirror of the rationale in `apps/server/src/queue/ffmpeg.ts`.
 */
const HWACCEL_LABEL: Record<EncoderHwaccel, string> = {
  software: "Software (libx264 / libx265)",
  nvenc: "NVIDIA NVENC",
  qsv: "Intel Quick Sync (QSV)",
  amf: "AMD AMF",
  vaapi: "VA-API (Linux)",
};

const PRESET_SUGGESTIONS: Record<EncoderHwaccel, ReadonlyArray<string>> = {
  software: [
    "ultrafast",
    "superfast",
    "veryfast",
    "faster",
    "fast",
    "medium",
    "slow",
    "slower",
    "veryslow",
  ],
  nvenc: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
  qsv: ["veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"],
  amf: ["speed", "balanced", "quality"],
  vaapi: [], // VAAPI ignores the preset; still required by the schema.
};

const QUALITY_LABEL: Record<EncoderHwaccel, string> = {
  software: "CRF",
  nvenc: "CQ",
  qsv: "global_quality (ICQ)",
  amf: "QP",
  vaapi: "QP",
};

/**
 * Editor for the encoder profile. Capability matrix is fetched lazily on
 * mount and used to grey out hwaccel/codec combos the host's ffmpeg
 * wasn't compiled with — the underlying `<select>` still accepts any
 * value (admins might know better than the probe), it's just a hint.
 */
function EncoderConfigCard({
  encoder,
  onChange,
}: {
  encoder: AdminEncoderConfig;
  onChange: (next: AdminRuntimeConfig) => void;
}) {
  const [form, setForm] = React.useState<AdminEncoderConfig>(encoder);
  const [pending, setPending] = React.useState(false);
  const [caps, setCaps] = React.useState<AdminEncoderCapabilities | null>(null);
  const [capsError, setCapsError] = React.useState<string | null>(null);

  // Re-sync when the parent config changes (e.g. after a successful save
  // bubbles up). Compare by reference — config-store hands us a fresh
  // object on every patch.
  React.useEffect(() => {
    setForm(encoder);
  }, [encoder]);

  React.useEffect(() => {
    let cancelled = false;
    fetchEncoderCapabilities()
      .then((next) => {
        if (!cancelled) setCaps(next);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setCapsError(
          cause instanceof Error
            ? cause.message
            : "Couldn't probe ffmpeg capabilities",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function set<K extends keyof AdminEncoderConfig>(
    key: K,
    value: AdminEncoderConfig[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const next = await updateEncoderConfig(form);
      onChange(next);
      toast.success("Encoder updated");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't update encoder",
      );
    } finally {
      setPending(false);
    }
  }

  const currentCombo = caps?.available[form.hwaccel];
  const currentComboMissing =
    caps !== null && currentCombo !== undefined && !currentCombo[form.codec];

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Encoder</CardTitle>
            <CardDescription>
              Hardware backend, codec, and quality used for new encode jobs.
              Changes apply to the next job; in-flight encodes finish on the
              previous settings.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {capsError ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{capsError}</span>
            </div>
          ) : null}

          {caps && !caps.ffmpegOk ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                ffmpeg isn&rsquo;t reachable on the server. Encodes will fail
                until the binary is on PATH (or <code>FFMPEG_BIN</code> points
                at it).
              </span>
            </div>
          ) : null}

          {caps?.ffmpegVersion ? (
            <p className="text-xs text-muted-foreground">
              Detected: <span className="font-mono">{caps.ffmpegVersion}</span>
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="encoder-hwaccel">Backend</FieldLabel>
              <NativeSelect
                id="encoder-hwaccel"
                className="w-full"
                value={form.hwaccel}
                onChange={(e) =>
                  set("hwaccel", e.target.value as EncoderHwaccel)
                }
              >
                {ENCODER_HWACCELS.map((hw) => {
                  const row = caps?.available[hw];
                  const anyCodec = row
                    ? row.h264 || row.hevc
                    : true; /* probe pending — don't pre-grey */
                  return (
                    <option key={hw} value={hw} disabled={!anyCodec}>
                      {HWACCEL_LABEL[hw]}
                      {row && !anyCodec ? " — unavailable" : ""}
                    </option>
                  );
                })}
              </NativeSelect>
              <FieldDescription>
                Software is the safe default. Hardware backends require a
                compatible GPU and an ffmpeg build with the matching encoder
                compiled in.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="encoder-codec">Codec</FieldLabel>
              <NativeSelect
                id="encoder-codec"
                className="w-full"
                value={form.codec}
                onChange={(e) => set("codec", e.target.value as EncoderCodec)}
              >
                {ENCODER_CODECS.map((codec) => {
                  const ok = currentCombo ? currentCombo[codec] : true;
                  return (
                    <option key={codec} value={codec} disabled={!ok}>
                      {codec.toUpperCase()}
                      {currentCombo && !ok ? " — unavailable" : ""}
                    </option>
                  );
                })}
              </NativeSelect>
              {currentComboMissing ? (
                <FieldDescription className="text-destructive">
                  This combination isn&rsquo;t available in the host&rsquo;s
                  ffmpeg build. Encodes will fail.
                </FieldDescription>
              ) : null}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="encoder-quality">
                Quality ({QUALITY_LABEL[form.hwaccel]})
              </FieldLabel>
              <Input
                id="encoder-quality"
                type="number"
                min={0}
                max={51}
                step={1}
                required
                value={form.quality}
                onChange={(e) =>
                  set("quality", clampInt(e.target.value, 0, 51, form.quality))
                }
              />
              <FieldDescription>
                0–51, lower = higher quality. 23 is a reasonable default for
                H.264/H.265 software encoding; hardware backends usually want
                slightly higher numbers for the same visual quality.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="encoder-preset">Preset</FieldLabel>
              <Input
                id="encoder-preset"
                list="encoder-preset-suggestions"
                value={form.preset}
                required
                onChange={(e) => set("preset", e.target.value)}
                disabled={form.hwaccel === "vaapi"}
                placeholder={form.hwaccel === "vaapi" ? "Ignored by VA-API" : ""}
              />
              <datalist id="encoder-preset-suggestions">
                {PRESET_SUGGESTIONS[form.hwaccel].map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              <FieldDescription>
                Speed/quality knob. Suggestions reflect the current backend.
              </FieldDescription>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="encoder-target-height">
                Target height
              </FieldLabel>
              <NativeSelect
                id="encoder-target-height"
                className="w-full"
                value={String(form.targetHeight)}
                onChange={(e) =>
                  set(
                    "targetHeight",
                    Number(e.target.value) as EncoderTargetHeight,
                  )
                }
              >
                {ENCODER_TARGET_HEIGHTS.map((h) => (
                  <option key={h} value={h}>
                    {h}p
                  </option>
                ))}
              </NativeSelect>
              <FieldDescription>
                Source clips taller than this are downscaled; shorter clips are
                left at their original height.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="encoder-audio-bitrate">
                Audio bitrate (kbps)
              </FieldLabel>
              <Input
                id="encoder-audio-bitrate"
                type="number"
                min={32}
                max={384}
                step={8}
                required
                value={form.audioBitrateKbps}
                onChange={(e) =>
                  set(
                    "audioBitrateKbps",
                    clampInt(e.target.value, 32, 384, form.audioBitrateKbps),
                  )
                }
              />
              <FieldDescription>
                AAC stereo. 128 kbps is fine for game/voice clips; bump to 192+
                for music-heavy content.
              </FieldDescription>
            </Field>
          </div>

          {form.hwaccel === "vaapi" ? (
            <Field>
              <FieldLabel htmlFor="encoder-vaapi-device">
                VA-API device
              </FieldLabel>
              <Input
                id="encoder-vaapi-device"
                value={form.vaapiDevice}
                required
                onChange={(e) => set("vaapiDevice", e.target.value)}
                placeholder="/dev/dri/renderD128"
              />
              <FieldDescription>
                Path to the DRM render node passed to ffmpeg&rsquo;s{" "}
                <code>-vaapi_device</code>. Only used when the backend is
                VA-API.
              </FieldDescription>
            </Field>
          ) : null}
        </CardContent>

        <CardFooter>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={pending}
          >
            {pending ? "Saving…" : "Save encoder"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

/**
 * Editor for upload + queue limits. `maxUploadBytes` and `uploadTtlSec`
 * are picked up on the next `/initiate` call. `queueConcurrency` is
 * registered with pg-boss at boot — surfaced as a restart-required hint.
 */
function LimitsConfigCard({
  limits,
  onChange,
}: {
  limits: AdminLimitsConfig;
  onChange: (next: AdminRuntimeConfig) => void;
}) {
  const [form, setForm] = React.useState<AdminLimitsConfig>(limits);
  const [pending, setPending] = React.useState(false);
  // Edit max upload as MiB to keep the input ergonomic; bytes is the
  // wire format. We round on display and convert back on save.
  const [maxUploadMiB, setMaxUploadMiB] = React.useState<string>(() =>
    String(Math.round(limits.maxUploadBytes / (1024 * 1024))),
  );

  React.useEffect(() => {
    setForm(limits);
    setMaxUploadMiB(String(Math.round(limits.maxUploadBytes / (1024 * 1024))));
  }, [limits]);

  function set<K extends keyof AdminLimitsConfig>(
    key: K,
    value: AdminLimitsConfig[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const parsedMiB = Number(maxUploadMiB);
    if (!Number.isFinite(parsedMiB) || parsedMiB <= 0) {
      toast.error("Max upload size must be a positive number of MiB.");
      return;
    }
    setPending(true);
    try {
      const next = await updateLimitsConfig({
        ...form,
        maxUploadBytes: Math.round(parsedMiB * 1024 * 1024),
      });
      onChange(next);
      toast.success("Limits updated");
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't update limits",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Upload &amp; queue limits</CardTitle>
            <CardDescription>
              Per-file upload cap, ticket TTL, and worker concurrency.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="limits-max-upload">
                Max upload size (MiB)
              </FieldLabel>
              <Input
                id="limits-max-upload"
                type="number"
                min={1}
                max={64 * 1024}
                step={1}
                required
                value={maxUploadMiB}
                onChange={(e) => setMaxUploadMiB(e.target.value)}
              />
              <FieldDescription>
                Hard per-file cap enforced at <code>/initiate</code> and again
                inside the upload token. Server caps this at 64 GiB.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="limits-ttl">
                Upload ticket TTL (seconds)
              </FieldLabel>
              <Input
                id="limits-ttl"
                type="number"
                min={60}
                max={86_400}
                step={30}
                required
                value={form.uploadTtlSec}
                onChange={(e) =>
                  set(
                    "uploadTtlSec",
                    clampInt(e.target.value, 60, 86_400, form.uploadTtlSec),
                  )
                }
              />
              <FieldDescription>
                How long a freshly minted upload URL stays valid. 15 min is
                comfortable for slow connections.
              </FieldDescription>
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="limits-concurrency">
              Queue concurrency
            </FieldLabel>
            <Input
              id="limits-concurrency"
              type="number"
              min={1}
              max={16}
              step={1}
              required
              value={form.queueConcurrency}
              onChange={(e) =>
                set(
                  "queueConcurrency",
                  clampInt(e.target.value, 1, 16, form.queueConcurrency),
                )
              }
            />
            <FieldDescription className="flex items-start gap-1.5">
              <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                How many encode jobs run in parallel. Changes here require a
                server restart — pg-boss registers concurrency once at boot.
              </span>
            </FieldDescription>
          </Field>
        </CardContent>

        <CardFooter>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={pending}
          >
            {pending ? "Saving…" : "Save limits"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

/**
 * Parse a number input value, clamp it into [min, max], and fall back to
 * the prior value if the new input doesn't parse. Avoids letting the
 * controlled input flip to NaN when the user clears the field mid-edit.
 */
function clampInt(
  raw: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
