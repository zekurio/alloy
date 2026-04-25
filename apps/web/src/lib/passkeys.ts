import { authClient } from "./auth-client"

export async function addPasskeyWithLabel({
  context,
  label,
}: {
  context?: string | null
  label?: string | null
}) {
  const result = await authClient.passkey.addPasskey({ context })
  if (result.error || !result.data) return result

  const trimmedLabel = label?.trim()
  if (!trimmedLabel) return result

  const update = await authClient.passkey.updatePasskey({
    id: result.data.id,
    name: trimmedLabel,
  })
  if (update.error) {
    return {
      data: null,
      error: update.error,
    }
  }

  return result
}
