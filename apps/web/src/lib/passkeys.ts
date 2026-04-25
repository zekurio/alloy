import { authClient } from "./auth-client"

export async function addPasskeyWithLabel({
  context,
  label,
  promptForLabel = false,
}: {
  context?: string | null
  label?: string | null
  promptForLabel?: boolean
}) {
  const trimmedLabel = label?.trim()
  const result = await authClient.passkey.addPasskey({
    context,
    name: promptForLabel ? undefined : trimmedLabel || undefined,
  })
  if (result.error || !result.data || !promptForLabel) return result
  if (typeof window === "undefined") return result

  const promptedLabel = window
    .prompt("Name this passkey", trimmedLabel || "Personal passkey")
    ?.trim()
  if (!promptedLabel) return result

  await authClient.passkey
    .updatePasskey({
      id: result.data.id,
      name: promptedLabel,
    })
    .catch(() => null)
  return result
}
