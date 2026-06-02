type ProfileIdentityFields = {
  email: string
  name: string
  username: string
}

export function normalizeProfileIdentity(
  value: ProfileIdentityFields
): ProfileIdentityFields {
  return {
    email: value.email.trim(),
    name: value.name.trim(),
    username: value.username.trim(),
  }
}

export function profileIdentityPatch(
  current: ProfileIdentityFields,
  initial: ProfileIdentityFields
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
  if (normalizedCurrent.name !== normalizedInitial.name) {
    patch.name = normalizedCurrent.name
  }
  if (normalizedCurrent.username !== normalizedInitial.username) {
    patch.username = normalizedCurrent.username
  }

  return patch
}

export function profileIdentityChanged(
  current: ProfileIdentityFields,
  initial: ProfileIdentityFields
): boolean {
  return Object.keys(profileIdentityPatch(current, initial)).length > 0
}
