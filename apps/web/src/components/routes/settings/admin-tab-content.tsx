import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  BrainCircuitIcon,
  ClapperboardIcon,
  DatabaseIcon,
  DownloadIcon,
  ImageIcon,
  PaletteIcon,
  RotateCcwIcon,
  ShieldIcon,
  UploadIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Section, SectionContent } from "@workspace/ui/components/section"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/lib/toast"

import { AdminUsersCard } from "@/components/admin/admin-users-card"
import { LoginArtwork } from "@/components/auth/login-artwork"
import { EncoderConfigCard } from "@/components/routes/admin-settings/encoder-config-card"
import { IntegrationsConfigCard } from "@/components/routes/admin-settings/integrations-config-card"
import { LimitsConfigCard } from "@/components/routes/admin-settings/limits-config-card"
import { MachineLearningConfigCard } from "@/components/routes/admin-settings/machine-learning-config-card"
import { OAuthProviderCard } from "@/components/routes/admin-settings/oauth-provider-card"
import { StorageConfigCard } from "@/components/routes/admin-settings/storage-config-card"
import { SettingsSection } from "@/components/routes/settings/settings-section"
import { loginSplashImageUrl, type AdminRuntimeConfig } from "@workspace/api"
import { api } from "@/lib/api"
import { adminRuntimeConfigQueryOptions } from "@/lib/admin-query-keys"
import { startBlobDownload } from "@/lib/browser-download"
import { formatDateTime, isoDateStamp } from "@/lib/date-format"
import { apiOrigin } from "@/lib/env"
import { errorMessage } from "@/lib/error-message"
import { publishRuntimeConfigUpdate } from "@/lib/runtime-config-events"

function useAdminConfig() {
  const configQuery = useQuery(adminRuntimeConfigQueryOptions())
  const [config, setConfig] = React.useState<AdminRuntimeConfig | null>(null)

  React.useEffect(() => {
    if (configQuery.data) setConfig(configQuery.data)
  }, [configQuery.data])

  const loadError = configQuery.error
    ? errorMessage(configQuery.error, "Couldn't load settings")
    : null

  return { config, setConfig, loadError }
}

type BoolToggleKey =
  | "openRegistrations"
  | "passkeyEnabled"
  | "requireAuthToBrowse"

function useAdminToggles(
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
) {
  const [pendingKey, setPendingKey] = React.useState<BoolToggleKey | null>(null)
  const patch = async (
    key: BoolToggleKey,
    next: boolean,
    successMsg: string
  ) => {
    if (pendingKey) return
    let previous: AdminRuntimeConfig | null = null
    setPendingKey(key)
    setConfig((prev) => {
      previous = prev
      return prev ? { ...prev, [key]: next } : prev
    })
    try {
      const updated = await api.admin.updateRuntimeConfig({ [key]: next })
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      setConfig(updated)
      toast.success(successMsg)
    } catch (cause) {
      setConfig(previous)
      toast.error(errorMessage(cause, "Update failed"))
    } finally {
      setPendingKey(null)
    }
  }
  return {
    pendingKey,
    onToggleOpenRegistrations: (next: boolean) =>
      patch(
        "openRegistrations",
        next,
        next ? "Registrations open" : "Registrations closed"
      ),
    onTogglePasskey: (next: boolean) =>
      patch(
        "passkeyEnabled",
        next,
        next ? "Passkeys enabled" : "Passkeys disabled"
      ),
    onToggleRequireAuthToBrowse: (next: boolean) =>
      patch(
        "requireAuthToBrowse",
        next,
        next ? "Sign-in required to browse" : "Public browsing enabled"
      ),
  }
}

function hasEnabledOAuthProvider(config: AdminRuntimeConfig): boolean {
  return config.oauthProvider?.enabled === true
}

function hasAnotherSignInMethod(
  config: AdminRuntimeConfig,
  excluding: "passkey" | "oauth"
): boolean {
  return (
    (excluding !== "passkey" && config.passkeyEnabled) ||
    (excluding !== "oauth" && hasEnabledOAuthProvider(config))
  )
}

function ToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  title: string
  description: string
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 not-last:border-b not-last:border-border first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-0.5 text-xs text-foreground-dim">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  )
}

function AuthenticationSettingsSection({
  config,
  setConfig,
  onToggleOpenRegistrations,
  onTogglePasskey,
  onToggleRequireAuthToBrowse,
  pendingToggleKey,
}: {
  config: AdminRuntimeConfig
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
  onToggleOpenRegistrations: (next: boolean) => void
  onTogglePasskey: (next: boolean) => void
  onToggleRequireAuthToBrowse: (next: boolean) => void
  pendingToggleKey: BoolToggleKey | null
}) {
  const togglePending = pendingToggleKey !== null
  return (
    <SettingsSection
      icon={ShieldIcon}
      title="Authentication"
      description="Control sign-in providers, registrations, passkeys, and public browsing."
    >
      <div className="flex flex-col gap-4">
        <Section>
          <SectionContent className="flex flex-col py-0">
            <ToggleRow
              title="Passkeys"
              description="Allow passkey sign-in and passkey-based account creation on supported browsers."
              checked={config.passkeyEnabled}
              onCheckedChange={onTogglePasskey}
              disabled={
                togglePending ||
                (config.passkeyEnabled &&
                  !hasAnotherSignInMethod(config, "passkey"))
              }
            />
            <ToggleRow
              title="Open registrations"
              description="Allow new accounts through enabled sign-up methods. OAuth uses this to auto-create accounts on first sign-in."
              checked={config.openRegistrations}
              onCheckedChange={onToggleOpenRegistrations}
              disabled={togglePending}
            />
            <ToggleRow
              title="Require sign-in to browse"
              description="Off lets anyone view clips, games, and profiles. Uploads still need an account."
              checked={config.requireAuthToBrowse}
              onCheckedChange={onToggleRequireAuthToBrowse}
              disabled={togglePending}
            />
          </SectionContent>
        </Section>
        <hr className="border-border" />
        <OAuthProviderCard config={config} onChange={setConfig} hideHeader />
      </div>
    </SettingsSection>
  )
}

function EncoderSettingsSection({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
}) {
  return (
    <SettingsSection
      icon={ClapperboardIcon}
      title="Encoding pipeline"
      description="Edit hardware acceleration, processing, and playback variants."
    >
      <EncoderConfigCard
        encoder={config.encoder}
        onChange={(next) => setConfig(next)}
        hideHeader
      />
    </SettingsSection>
  )
}

function MachineLearningSettingsSection({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
}) {
  return (
    <SettingsSection
      icon={BrainCircuitIcon}
      title="ML game suggestions"
      description="Edit inference service settings and the classifier model."
    >
      <MachineLearningConfigCard
        machineLearning={config.machineLearning}
        onChange={(next) => setConfig(next)}
        hideHeader
      />
    </SettingsSection>
  )
}

function StorageSettingsSection({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
}) {
  return (
    <SettingsSection
      icon={DatabaseIcon}
      title="Storage"
      description="Edit upload caps, default quota, queue concurrency, and the clip storage backend."
    >
      <div className="flex flex-col gap-4">
        <LimitsConfigCard
          limits={config.limits}
          onChange={(next) => setConfig(next)}
          hideHeader
        />
        <hr className="border-border" />
        <StorageConfigCard
          storage={config.storage}
          onChange={(next) => setConfig(next)}
          hideHeader
        />
      </div>
    </SettingsSection>
  )
}

function SteamGridDBSettingsSection({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
}) {
  return (
    <SettingsSection
      icon={ImageIcon}
      title="Game artwork"
      description="Edit the SteamGridDB API key used for cover art and metadata."
    >
      <IntegrationsConfigCard
        integrations={config.integrations}
        onChange={(next) => setConfig(next)}
        hideHeader
      />
    </SettingsSection>
  )
}

function AppearanceSettingsSection({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
}) {
  const [pending, setPending] = React.useState(false)
  const splash = config.appearance.loginSplash
  const previewImageUrl = React.useMemo(() => {
    if (splash.clipIds.length === 0) return null
    return loginSplashImageUrl(apiOrigin(), splash.generatedAt)
  }, [splash.clipIds.length, splash.generatedAt])

  async function updateSplashEnabled(next: boolean) {
    if (pending) return
    setPending(true)
    try {
      const updated = await api.admin.updateAppearanceConfig({
        loginSplash: { enabled: next },
      })
      setConfig(updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      toast.success(next ? "Login backdrop enabled" : "Login backdrop disabled")
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't update backdrop"))
    } finally {
      setPending(false)
    }
  }

  async function regenerateSplash() {
    if (pending) return
    setPending(true)
    try {
      const updated = await api.admin.regenerateLoginSplash()
      setConfig(updated)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      toast.success("Login backdrop regenerated")
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't regenerate backdrop"))
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingsSection
      icon={PaletteIcon}
      title="Login appearance"
      description="Edit the generated clip backdrop shown on the login page."
    >
      <Section>
        <SectionContent className="flex flex-col gap-4">
          <div className="relative aspect-video overflow-hidden rounded-md border border-border bg-surface">
            {previewImageUrl ? (
              <LoginArtwork imageUrl={previewImageUrl} />
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm text-foreground-muted">
                Enable or regenerate the login backdrop to pick public clips.
              </div>
            )}
          </div>
          <div className="flex items-start justify-between gap-4 py-3 not-last:border-b not-last:border-border first:pt-0">
            <div className="min-w-0">
              <div className="text-sm font-medium">Login backdrop</div>
              <p className="mt-0.5 text-xs text-foreground-dim">
                Use a generated collage from random public clip thumbnails.
              </p>
              {splash.generatedAt ? (
                <p className="mt-1 text-xs text-foreground-muted">
                  Last generated {formatDateTime(splash.generatedAt)}
                </p>
              ) : null}
            </div>
            <Switch
              checked={splash.enabled}
              onCheckedChange={updateSplashEnabled}
              disabled={pending}
            />
          </div>
          <div className="flex items-start justify-between gap-4 py-3 last:pb-0">
            <div className="min-w-0">
              <div className="text-sm font-medium">Regenerate</div>
              <p className="mt-0.5 text-xs text-foreground-dim">
                Pick a new random set from public clips with thumbnails.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={regenerateSplash}
              disabled={pending}
            >
              <RotateCcwIcon />
              Regenerate
            </Button>
          </div>
        </SectionContent>
      </Section>
    </SettingsSection>
  )
}

function ConfigTransferSection({
  setConfig,
}: {
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [exporting, setExporting] = React.useState(false)
  const [importing, setImporting] = React.useState(false)

  async function onExport() {
    setExporting(true)
    try {
      const data = await api.admin.exportRuntimeConfig()
      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: "application/json" })
      const started = startBlobDownload(
        blob,
        `alloy-config-${isoDateStamp()}.json`
      )
      if (!started) throw new Error("Export download failed")
      toast.success("Configuration exported")
    } catch (cause) {
      toast.error(errorMessage(cause, "Export failed"))
    } finally {
      setExporting(false)
    }
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setImporting(true)
    try {
      const text = await file.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error("Selected file is not valid JSON")
      }
      const updated = await api.admin.importRuntimeConfig(parsed)
      publishRuntimeConfigUpdate({ authConfigChanged: true })
      setConfig(updated)
      toast.success("Configuration imported")
    } catch (cause) {
      toast.error(errorMessage(cause, "Import failed"))
    } finally {
      setImporting(false)
    }
  }

  return (
    <SettingsSection
      icon={WrenchIcon}
      title="Config transfer"
      description="Export or replace server runtime configuration as JSON."
    >
      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-border py-3 first:pt-0">
          <div className="min-w-0">
            <div className="text-sm font-medium">Export</div>
            <p className="mt-0.5 text-xs text-foreground-dim">
              Download the current server configuration including secrets.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={exporting}
          >
            <DownloadIcon />
            {exporting ? "Exporting..." : "Export"}
          </Button>
        </div>
        <div className="flex items-start justify-between gap-4 py-3 last:pb-0">
          <div className="min-w-0">
            <div className="text-sm font-medium">Import</div>
            <p className="mt-0.5 text-xs text-foreground-dim">
              Replace the current configuration from a previously exported JSON
              file.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            <UploadIcon />
            {importing ? "Importing..." : "Import"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={onFileSelected}
          />
        </div>
      </div>
    </SettingsSection>
  )
}

export function AdminSettingsSections({ userId }: { userId: string }) {
  const { config, setConfig, loadError } = useAdminConfig()
  const {
    pendingKey: pendingToggleKey,
    onToggleOpenRegistrations,
    onTogglePasskey,
    onToggleRequireAuthToBrowse,
  } = useAdminToggles(setConfig)

  if (loadError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive sm:col-span-2">
        {loadError}
      </div>
    )
  }
  if (!config) return null

  return (
    <>
      <AuthenticationSettingsSection
        config={config}
        setConfig={setConfig}
        onToggleOpenRegistrations={onToggleOpenRegistrations}
        onTogglePasskey={onTogglePasskey}
        onToggleRequireAuthToBrowse={onToggleRequireAuthToBrowse}
        pendingToggleKey={pendingToggleKey}
      />
      <EncoderSettingsSection config={config} setConfig={setConfig} />
      <MachineLearningSettingsSection config={config} setConfig={setConfig} />
      <StorageSettingsSection config={config} setConfig={setConfig} />
      <AppearanceSettingsSection config={config} setConfig={setConfig} />
      <SteamGridDBSettingsSection config={config} setConfig={setConfig} />
      <SettingsSection
        icon={UsersIcon}
        title="Users"
        description="Edit user accounts, roles, and moderation state."
      >
        <AdminUsersCard currentUserId={userId} hideHeader />
      </SettingsSection>
      <ConfigTransferSection setConfig={setConfig} />
    </>
  )
}
