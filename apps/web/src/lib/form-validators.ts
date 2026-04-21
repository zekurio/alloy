const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

export const USERNAME_MIN_LEN = 1
export const USERNAME_MAX_LEN = 24
export const USERNAME_RE = /^[a-z0-9_-]+$/u

export function validateRequiredString(
  value: string,
  label: string
): string | undefined {
  return value.trim().length === 0 ? `${label} is required` : undefined
}

export function validateEmail(value: string): string | undefined {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return "Email is required"
  }

  if (!EMAIL_RE.test(trimmed)) {
    return "Enter a valid email address"
  }

  return undefined
}

export function validatePassword(
  value: string,
  minimumLength = 8
): string | undefined {
  if (value.length === 0) {
    return "Password is required"
  }

  if (value.length < minimumLength) {
    return `Password must be at least ${minimumLength} characters`
  }

  return undefined
}

export function validateUsername(value: string): string | undefined {
  const trimmed = value.trim()

  if (trimmed.length < USERNAME_MIN_LEN) {
    return "Username can't be empty"
  }

  if (trimmed.length > USERNAME_MAX_LEN) {
    return `Username can be at most ${USERNAME_MAX_LEN} characters`
  }

  if (!USERNAME_RE.test(trimmed)) {
    return "Only lowercase letters, numbers, underscores and hyphens"
  }

  return undefined
}
