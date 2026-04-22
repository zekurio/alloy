import * as React from "react"
import { Trash2Icon } from "lucide-react"

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
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"

import {
  type AdminIntegrationsConfig,
  type AdminRuntimeConfig,
  INTEGRATIONS_REDACTED,
  updateIntegrationsConfig,
} from "@/lib/admin-api"

type IntegrationsConfigCardProps = {
  integrations: AdminIntegrationsConfig
  onChange: (next: AdminRuntimeConfig) => void
}

export function IntegrationsConfigCard({
  integrations,
  onChange,
}: IntegrationsConfigCardProps) {
  const blankForm = (
    src: AdminIntegrationsConfig
  ): AdminIntegrationsConfig => ({
    ...src,
    steamgriddbApiKey:
      src.steamgriddbApiKey === INTEGRATIONS_REDACTED
        ? ""
        : src.steamgriddbApiKey,
  })

  const [form, setForm] = React.useState<AdminIntegrationsConfig>(() =>
    blankForm(integrations)
  )
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    setForm(blankForm(integrations))
  }, [integrations])

  const steamgriddbConfigured =
    integrations.steamgriddbApiKey === INTEGRATIONS_REDACTED

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    setPending(true)
    try {
      const patch: Partial<AdminIntegrationsConfig> = {}
      if (form.steamgriddbApiKey !== "") {
        patch.steamgriddbApiKey = form.steamgriddbApiKey
      }
      if (Object.keys(patch).length === 0) {
        toast.info("No changes to save")
        return
      }
      const next = await updateIntegrationsConfig(patch)
      onChange(next)
      toast.success("Integrations updated")
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't update integrations"
      )
    } finally {
      setPending(false)
    }
  }

  async function onClearSteamGridDB() {
    if (pending) return
    setPending(true)
    try {
      const next = await updateIntegrationsConfig({ steamgriddbApiKey: "" })
      onChange(next)
      toast.success("SteamGridDB key removed")
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Couldn't remove key"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>SteamGridDB</CardTitle>
            <CardDescription>
              Unlocks the game picker and cover art. Get a key at{" "}
              <a
                href="https://www.steamgriddb.com/profile/preferences/api"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                steamgriddb.com
              </a>
              .
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="sgdb-api-key">API key</FieldLabel>
            <Input
              id="sgdb-api-key"
              type="password"
              autoComplete="new-password"
              value={form.steamgriddbApiKey}
              placeholder={
                steamgriddbConfigured ? "Leave blank to keep current" : ""
              }
              onChange={(e) =>
                setForm((f) => ({ ...f, steamgriddbApiKey: e.target.value }))
              }
            />
            <FieldDescription>
              {steamgriddbConfigured
                ? "Configured. Type a new value to rotate."
                : "Not configured — game picker is disabled."}
            </FieldDescription>
          </Field>
        </CardContent>

        <CardFooter>
          {steamgriddbConfigured ? (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={pending}
                  >
                    <Trash2Icon />
                    Remove key
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove SteamGridDB key?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This disables the game picker and cover art integration
                    until a new key is added.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={pending}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={onClearSteamGridDB}
                    disabled={pending}
                  >
                    {pending ? "Removing…" : "Remove key"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
