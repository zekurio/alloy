type ProfileIdentityFields = {
  email: string
  username: string
  displayName: string
}

export function normalizeProfileIdentity(
  value: ProfileIdentityFields,
): ProfileIdentityFields {
  return {
    email: value.email.trim(),
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

  if (
    normalizedCurrent.email.toLowerCase() !==
    normalizedInitial.email.toLowerCase()
  ) {
    patch.email = normalizedCurrent.email
  }
  if (normalizedCurrent.username !== normalizedInitial.username) {
    patch.username = normalizedCurrent.username
  }
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
