import * as React from "react"
import { PencilIcon, PlusIcon, Trash2Icon, UserKeyIcon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@workspace/ui/components/section"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/lib/toast"

import type { AdminOAuthProvider, AdminRuntimeConfig } from "@workspace/api"

import { api } from "@/lib/api"
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
      const updated = await api.admin.saveOAuthConfig({ oauthProvider: next })
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
      <Section>
        <SectionHeader className="border-b-0 pb-0">
          <SectionTitle>OIDC / OAuth provider</SectionTitle>
        </SectionHeader>
        <SectionContent className="flex items-center justify-between gap-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
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
                disabled={
                  disabled ||
                  (provider.enabled &&
                    !config.emailPasswordEnabled &&
                    !config.passkeyEnabled)
                }
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
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={disabled}
                    >
                      <Trash2Icon />
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove OAuth provider?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This disables sign-in through {provider.displayName}. You
                      can add it back later.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={disabled}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={removeProvider}
                      disabled={disabled}
                    >
                      {disabled ? "Removing…" : "Remove provider"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
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
        </SectionContent>
      </Section>

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
