import { Button } from "alloy-ui/components/button"
import { Field, FieldLabel } from "alloy-ui/components/field"
import { Input } from "alloy-ui/components/input"
import { toast } from "alloy-ui/lib/toast"
import { CopyIcon } from "lucide-react"

import { copyTextToClipboard } from "@/lib/clipboard"

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
              "Couldn't copy callback URL",
            )
          }
        >
          <CopyIcon />
        </Button>
      </div>
    </Field>
  )
}

async function copyToClipboard(
  value: string,
  successMessage: string,
  errorMessage: string,
) {
  const copied = await copyTextToClipboard(value, {
    action: "copy OAuth callback URL",
  })
  if (copied) {
    toast.success(successMessage)
  } else {
    toast.error(errorMessage)
  }
}
