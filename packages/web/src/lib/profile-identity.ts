type ProfileIdentityFields = {
  username: string
  displayName: string
}

export function normalizeProfileIdentity(
  value: ProfileIdentityFields,
): ProfileIdentityFields {
  return {
    username: value.username.trim(),
    displayName: value.displayName.trim(),
  }
}

export function profileIdentityPatch(
  current: ProfileIdentityFields,
  initial: ProfileIdentityFields,
): Partial<ProfileIdentityFields> {
  const normalizedCurrent = normalizeProfileIdentity(current)
  const normalizedInitial = normalizeProfileIdentity(initial)
  const patch: Partial<ProfileIdentityFields> = {}

  if (normalizedCurrent.username !== normalizedInitial.username) {
    patch.username = normalizedCurrent.username
  }
  // An empty string is a real value here — it is how the user clears their
  // display name, so this must not be folded into "unchanged".
  if (normalizedCurrent.displayName !== normalizedInitial.displayName) {
    patch.displayName = normalizedCurrent.displayName
  }

  return patch
}

export function profileIdentityChanged(
  current: ProfileIdentityFields,
  initial: ProfileIdentityFields,
): boolean {
  return Object.keys(profileIdentityPatch(current, initial)).length > 0
}
