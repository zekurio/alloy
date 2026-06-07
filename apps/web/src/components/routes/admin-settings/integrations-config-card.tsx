import { useQueryClient } from "@tanstack/react-query"
import type { AdminIntegrationsConfig, AdminRuntimeConfig } from "alloy-api"
import { Button } from "alloy-ui/components/button"
import { Field, FieldLabel } from "alloy-ui/components/field"
import { InputGroup, InputGroupInput } from "alloy-ui/components/input-group"
import {
  Section,
  SectionContent,
  SectionFooter,
  SectionHeader,
  SectionTitle,
} from "alloy-ui/components/section"
import { toast } from "alloy-ui/lib/toast"
import { SaveIcon } from "lucide-react"
import * as React from "react"

import { api } from "@/lib/api"
import { errorMessage } from "@/lib/error-message"
import { gameKeys } from "@/lib/game-queries"

type IntegrationsConfigCardProps = {
  integrations: AdminIntegrationsConfig
  onChange: (next: AdminRuntimeConfig) => void
  /** Called after a successful save (or when submitted with no changes). */
  onSaved?: () => void
  /** Hide the footer action buttons (Cancel / Save). */
  hideActions?: boolean
  /** Hide the section header (useful when already wrapped in a titled collapsible). */
  hideHeader?: boolean
  /** HTML `id` for the `<form>` element, useful for external submit buttons. */
  formId?: string
  /** Show the success toast after saving. */
  toastOnSuccess?: boolean
}

function updateSteamGridDBStatus(
  queryClient: ReturnType<typeof useQueryClient>,
  steamgriddbConfigured: boolean,
) {
  queryClient.setQueryData(gameKeys.status(), { steamgriddbConfigured })
  void queryClient.invalidateQueries({ queryKey: gameKeys.status() })
}

export function IntegrationsConfigCard({
  integrations,
  onChange,
  onSaved,
  hideActions,
  hideHeader,
  formId,
  toastOnSuccess = true,
}: IntegrationsConfigCardProps) {
  const queryClient = useQueryClient()
  // The stored key is a secret and never sent to the client. The field holds a
  // new value to write; blank means "keep the current key".
  const [apiKey, setApiKey] = React.useState("")
  const [pending, setPending] = React.useState(false)

  // Clear the write field whenever the configured state changes (e.g. on save).
  React.useEffect(() => {
    setApiKey("")
  }, [integrations.steamgriddbApiKeySet])

  const steamgriddbConfigured = integrations.steamgriddbApiKeySet
  const isDirty = apiKey.trim().length > 0

  function resetForm() {
    setApiKey("")
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    if (!isDirty) {
      onSaved?.()
      return
    }
    setPending(true)
    try {
      const next = await api.admin.updateIntegrationsConfig({
        steamgriddbApiKey: apiKey.trim(),
      })
      onChange(next)
      updateSteamGridDBStatus(queryClient, true)
      if (toastOnSuccess) toast.success("Integrations updated")
      onSaved?.()
    } catch (cause) {
      toast.error(errorMessage(cause, "Couldn't update integrations"))
    } finally {
      setPending(false)
    }
  }

  return (
    <form id={formId} onSubmit={onSubmit}>
      <Section>
        {!hideHeader && (
          <SectionHeader>
            <SectionTitle>SteamGridDB</SectionTitle>
          </SectionHeader>
        )}

        <fieldset disabled={pending} className="contents">
          <SectionContent className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="sgdb-api-key">API key</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="sgdb-api-key"
                  type="password"
                  className="pl-3.5"
                  autoComplete="new-password"
                  value={apiKey}
                  placeholder={
                    steamgriddbConfigured ? "Leave blank to keep current" : ""
                  }
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </InputGroup>
            </Field>
          </SectionContent>

          {!hideActions && (
            <SectionFooter className="justify-end">
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Button
                  className="flex-1 sm:flex-initial"
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetForm}
                  disabled={pending || !isDirty}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 sm:flex-initial"
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={pending || !isDirty}
                >
                  <SaveIcon />
                  {pending ? "Saving…" : "Save"}
                </Button>
              </div>
            </SectionFooter>
          )}
        </fieldset>
      </Section>
    </form>
  )
}
