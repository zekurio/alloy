import { authClient } from "./auth-client"

export async function addPasskeyWithLabel({
  label,
}: {
  label?: string | null
}) {
  const trimmedLabel = label?.trim()
  const result = await authClient.passkey.addPasskey({
    name: trimmedLabel || undefined,
  })
  return result
}
