import { CopyIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"

export function OAuthCallbackField({
  id,
  label,
  value,
}: {
  id: string
  label: string
  value: string
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input id={id} value={value} readOnly />
        <Button
          type="button"
          variant="outline"
          className="size-10 shrink-0 p-0"
          title="Copy callback URL"
          aria-label="Copy callback URL"
          onClick={() =>
            copyToClipboard(
              value,
              "Callback URL copied",
              "Couldn't copy callback URL"
            )
          }
        >
          <CopyIcon />
        </Button>
      </div>
    </Field>
  )
}

export function scopeInputValue(scopes: string[] | undefined): string {
  return scopes?.join(", ") ?? ""
}

export function parseScopes(raw: string): string[] | undefined {
  const scopes = raw
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean)
  return scopes.length > 0 ? scopes : undefined
}

async function copyToClipboard(
  value: string,
  successMessage: string,
  errorMessage: string
) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(successMessage)
  } catch {
    toast.error(errorMessage)
  }
}
