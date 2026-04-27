import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ClapperboardIcon,
  DatabaseIcon,
  DownloadIcon,
  GaugeIcon,
  ImageIcon,
  KeyRoundIcon,
  UploadIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@workspace/ui/components/section"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/lib/toast"

import { AdminUsersCard } from "@/components/admin/admin-users-card"
import { EncoderConfigCard } from "@/components/routes/admin-settings/encoder-config-card"
import { IntegrationsConfigCard } from "@/components/routes/admin-settings/integrations-config-card"
import { LimitsConfigCard } from "@/components/routes/admin-settings/limits-config-card"
import { OAuthProviderCard } from "@/components/routes/admin-settings/oauth-provider-card"
import { StorageConfigCard } from "@/components/routes/admin-settings/storage-config-card"
import { SettingsSection } from "@/components/routes/settings/settings-section"
import { type AdminRuntimeConfig } from "@workspace/api"
import { api } from "@/lib/api"
import { publishRuntimeConfigUpdate } from "@/lib/runtime-config-events"

const adminRuntimeConfigQueryKey = ["admin", "runtime-config"] as const

function useAdminConfig() {
  const configQuery = useQuery({
    queryKey: adminRuntimeConfigQueryKey,
    queryFn: () => api.admin.fetchRuntimeConfig(),
  })
  const [config, setConfig] = React.useState<AdminRuntimeConfig | null>(null)

  React.useEffect(() => {
    if (configQuery.data) setConfig(configQuery.data)
  }, [configQuery.data])

  const loadError = configQuery.error
    ? configQuery.error instanceof Error
      ? configQuery.error.message
      : "Couldn't load settings"
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
  const patch = async (
    key: BoolToggleKey,
    next: boolean,
    successMsg: string
  ) => {
    let previous: AdminRuntimeConfig | null = null
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
      toast.error(cause instanceof Error ? cause.message : "Update failed")
    }
  }
  return {
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

function AuthSettingsSection({
  config,
  setConfig,
  onToggleOpenRegistrations,
  onTogglePasskey,
  onToggleRequireAuthToBrowse,
}: {
  config: AdminRuntimeConfig
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
  onToggleOpenRegistrations: (next: boolean) => void
  onTogglePasskey: (next: boolean) => void
  onToggleRequireAuthToBrowse: (next: boolean) => void
}) {
  return (
    <SettingsSection
      icon={KeyRoundIcon}
      title="Authentication"
      description="Configure sign-in methods and access controls."
    >
      <div className="flex flex-col gap-4">
        <OAuthProviderCard config={config} onChange={setConfig} hideHeader />
        <Section>
          <SectionHeader>
            <SectionTitle>Access controls</SectionTitle>
          </SectionHeader>
          <SectionContent className="flex flex-col">
            <ToggleRow
              title="Passkeys"
              description="Allow passkey sign-in and passkey-based account creation on supported browsers."
              checked={config.passkeyEnabled}
              onCheckedChange={onTogglePasskey}
              disabled={
                config.passkeyEnabled &&
                !hasAnotherSignInMethod(config, "passkey")
              }
            />
            <ToggleRow
              title="Open registrations"
              description="Allow new accounts through enabled sign-up methods. OAuth uses this to auto-create accounts on first sign-in."
              checked={config.openRegistrations}
              onCheckedChange={onToggleOpenRegistrations}
            />
            <ToggleRow
              title="Require sign-in to browse"
              description="Off lets anyone view clips, games, and profiles. Uploads still need an account."
              checked={config.requireAuthToBrowse}
              onCheckedChange={onToggleRequireAuthToBrowse}
            />
          </SectionContent>
        </Section>
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
      title="Encoder"
      description="Configure video encoding and hardware acceleration."
    >
      <EncoderConfigCard
        encoder={config.encoder}
        onChange={(next) => setConfig(next)}
        hideHeader
      />
    </SettingsSection>
  )
}

function LimitsSettingsSection({
  config,
  setConfig,
}: {
  config: AdminRuntimeConfig
  setConfig: React.Dispatch<React.SetStateAction<AdminRuntimeConfig | null>>
}) {
  return (
    <SettingsSection
      icon={GaugeIcon}
      title="Limits"
      description="Set upload size and storage quota defaults."
    >
      <LimitsConfigCard
        limits={config.limits}
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
      description="Configure where clips and uploads are stored."
    >
      <StorageConfigCard
        storage={config.storage}
        onChange={(next) => setConfig(next)}
        hideHeader
      />
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
      title="SteamGridDB"
      description="Game artwork and metadata from SteamGridDB."
    >
      <IntegrationsConfigCard
        integrations={config.integrations}
        onChange={(next) => setConfig(next)}
        hideHeader
      />
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
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `alloy-config-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success("Configuration exported")
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Export failed")
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
      toast.error(cause instanceof Error ? cause.message : "Import failed")
    } finally {
      setImporting(false)
    }
  }

  return (
    <SettingsSection
      icon={WrenchIcon}
      title="Configuration"
      description="Export or import server configuration as JSON."
    >
      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-4 py-3 border-b border-border first:pt-0">
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
    onToggleOpenRegistrations,
    onTogglePasskey,
    onToggleRequireAuthToBrowse,
  } = useAdminToggles(setConfig)

  if (loadError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {loadError}
      </div>
    )
  }
  if (!config) return null

  return (
    <>
      <AuthSettingsSection
        config={config}
        setConfig={setConfig}
        onToggleOpenRegistrations={onToggleOpenRegistrations}
        onTogglePasskey={onTogglePasskey}
        onToggleRequireAuthToBrowse={onToggleRequireAuthToBrowse}
      />
      <EncoderSettingsSection config={config} setConfig={setConfig} />
      <LimitsSettingsSection config={config} setConfig={setConfig} />
      <StorageSettingsSection config={config} setConfig={setConfig} />
      <SteamGridDBSettingsSection config={config} setConfig={setConfig} />
      <SettingsSection
        icon={UsersIcon}
        title="Users"
        description="Manage user accounts and permissions."
      >
        <AdminUsersCard currentUserId={userId} hideHeader />
      </SettingsSection>
      <ConfigTransferSection setConfig={setConfig} />
    </>
  )
}
