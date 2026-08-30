export function existingAccountChallengeOwnerId(
  userId: string | undefined,
): string | null {
  return userId ?? null
}

export function oauthChallengeOwnerId(
  mode: "sign-in" | "link",
  userId: string | undefined,
): string | null {
  return mode === "link" ? existingAccountChallengeOwnerId(userId) : null
}

export function legacyChallengeBelongsToUser(
  challenge: {
    purpose: string
    identifier: string
    payloadUserId?: string
    payloadUsername?: string
  },
  userId: string,
): boolean {
  const expected = userId.toLowerCase()
  if (challenge.payloadUserId?.toLowerCase() === expected) return true
  return (
    challenge.purpose === "passkey-registration" &&
    challenge.identifier.toLowerCase() === expected &&
    challenge.payloadUsername === undefined
  )
}
