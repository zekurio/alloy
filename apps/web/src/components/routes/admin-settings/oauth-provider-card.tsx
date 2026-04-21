import * as React from "react"
import { PencilIcon, PlusIcon, Trash2Icon, UserKeyIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/sonner"

import {
  saveOAuthConfig,
  type AdminOAuthProvider,
  type AdminRuntimeConfig,
} from "../../../lib/admin-api"
import { OAuthCustomProviderDialog } from "./oauth-custom-provider-dialog"
import { emptyProvider, toSubmissionProvider } from "./shared"

type OAuthProviderCardProps = {
  config: AdminRuntimeConfig
  onChange: (next: AdminRuntimeConfig) => void
}

export function OAuthProviderCard({
  config,
  onChange,
}: OAuthProviderCardProps) {
  const [draft, setDraft] = React.useState<AdminOAuthProvider | null>(null)
  const [editing, setEditing] = React.useState(false)
  const [pendingAction, setPendingAction] = React.useState<string | null>(null)

  const provider = config.oauthProvider

  async function persistProvider(
    next: AdminOAuthProvider | null,
    successMessage: string
  ) {
    setPendingAction(successMessage)
    try {
      const updated = await saveOAuthConfig({ oauthProvider: next })
      onChange(updated)
      toast.success(successMessage)
      return true
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't save OAuth settings"
      )
      return false
    } finally {
      setPendingAction(null)
    }
  }

  function openCreate() {
    setEditing(false)
    setDraft(emptyProvider())
  }

  function openEdit() {
    if (!provider) return
    setEditing(true)
    setDraft({ ...provider })
  }

  function closeDialog() {
    if (pendingAction) return
    setDraft(null)
    setEditing(false)
  }

  async function toggleEnabled(enabled: boolean) {
    if (pendingAction || !provider) return
    await persistProvider(
      { ...provider, enabled },
      enabled ? "Provider enabled" : "Provider disabled"
    )
  }

  async function removeProvider() {
    if (pendingAction) return
    await persistProvider(null, "Provider removed")
  }

  async function saveProvider(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!draft || pendingAction) return
    const ok = await persistProvider(
      toSubmissionProvider(draft),
      editing ? "Provider updated" : "Provider added"
    )
    if (ok) closeDialog()
  }

  function setDraftField<K extends keyof AdminOAuthProvider>(
    key: K,
    value: AdminOAuthProvider[K]
  ) {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  const disabled = pendingAction !== null

  return (
    <>
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <div className="min-w-0 flex items-center gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border">
              <UserKeyIcon className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {provider ? provider.displayName : "OAuth provider"}
              </div>
              <p className="truncate text-xs text-foreground-dim">
                {provider
                  ? provider.providerId
                  : "Configure a generic OIDC/OAuth2 provider (e.g. PocketID)."}
              </p>
            </div>
          </div>

          {provider ? (
            <div className="flex items-center gap-2">
              <Switch
                checked={provider.enabled}
                disabled={disabled}
                onCheckedChange={toggleEnabled}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                onClick={openEdit}
              >
                <PencilIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                onClick={removeProvider}
              >
                <Trash2Icon />
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={disabled}
              onClick={openCreate}
            >
              <PlusIcon />
              Add provider
            </Button>
          )}
        </CardContent>
      </Card>

      <OAuthCustomProviderDialog
        authBaseURL={config.authBaseURL}
        draft={draft}
        editing={editing}
        pendingAction={pendingAction}
        onOpenChange={(open) => !open && closeDialog()}
        onSubmit={saveProvider}
        onChange={setDraftField}
      />
    </>
  )
}
